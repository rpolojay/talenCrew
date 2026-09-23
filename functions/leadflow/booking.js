const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

const { COLLECTIONS, LEAD_STATUS, EVENT_TYPE } = require("./constants");
const { CAL_WEBHOOK_SECRET, BOOKING_TOKEN_SECRET } = require("./secrets");
const { buildEventDoc } = require("./pipeline");
const { verifyBookingMetadata } = require("./bookingToken");
const { EMAIL_RE } = require("./captureValidation");

// Webhook de Cal.com (BOOKING_CREATED → APPOINTMENT_BOOKED).
//
// Cal.com no tiene handshake de verificación: cada POST viene firmado con el
// header X-Cal-Signature-256 (HMAC-SHA256 hex del body CRUDO, con el secreto
// configurado al crear el webhook en Cal.com).
//
// Identificación del lead — SOLO por el link de reserva firmado
// (./bookingToken.js): metadata { leadId, companyId, bookingToken }. La firma
// de Cal.com prueba que el payload viene de Cal.com, pero la metadata la
// arma quien abre la página de reserva, así que por sí sola no prueba nada;
// el token prueba que ese par leadId+companyId lo emitió el backend. No hay
// fallback por email/teléfono del asistente: Cal.com no los verifica y una
// búsqueda global cruzaba empresas. Una reserva sin token válido no toca
// ningún lead.
//
// Respuestas:
//   405 método ≠ POST · 401 firma inválida · 400 body/payload mal formado
//   500 error interno (Firestore, secreto) — Cal.com puede reintentar; es
//       seguro porque el procesamiento es idempotente por booking uid
//   200 { result } en todo lo demás: reserva aplicada, duplicada, o
//       auténtica pero no aplicable (sin link firmado, lead inexistente,
//       estado que no admite reserva, evento no soportado). Son reservas
//       reales hechas en Cal.com que no nos corresponde reintentar.

function isValidCalSignature(req, secret) {
  const signatureHeader = req.get("x-cal-signature-256");
  if (!signatureHeader || !req.rawBody) {
    return false;
  }

  const computedHex = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");

  const expectedBuffer = Buffer.from(signatureHeader, "hex");
  const computedBuffer = Buffer.from(computedHex, "hex");
  if (expectedBuffer.length !== computedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, computedBuffer);
}

// Estados desde los que una reserva confirmada puede pasar el lead a
// APPOINTMENT_BOOKED. El link solo se envía en la ruta QUALIFIED
// (BOOKING_SENT), pero el lead puede seguir teniéndolo después de un mensaje
// que lo movió a CONTACTED, o de un movimiento manual a QUALIFIED/NURTURE; y
// APPOINTMENT_BOOKED admite una segunda reserva distinta (actualiza la cita).
// Fuera: NEW/ANALYZING (el pipeline no terminó, no hay link), HUMAN_REVIEW (una
// persona está a cargo: una reserva automática no lo saca de revisión) y
// CLOSED (cerrado a mano). En esos casos la reserva se registra en
// leadflow_bookings pero el lead no se toca.
const BOOKABLE_STATUSES = [
  LEAD_STATUS.BOOKING_SENT,
  LEAD_STATUS.CONTACTED,
  LEAD_STATUS.QUALIFIED,
  LEAD_STATUS.NURTURE,
  LEAD_STATUS.APPOINTMENT_BOOKED,
];

const SUPPORTED_EVENTS = ["BOOKING_CREATED"];
// TODO(B4): BOOKING_CANCELLED y BOOKING_RESCHEDULED se reciben pero no se
// procesan (200, sin cambios). Falta confirmar con payloads reales de la
// cuenta de Cal.com qué campos traen (¿metadata en la cancelación?, ¿uid
// original en la reprogramación?) y decidir a qué estado vuelve un lead que
// cancela.

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TEXT = 500;
const MAX_NAME = 120;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function isoDateOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 40 || Number.isNaN(Date.parse(value))) throw new Error("invalid date");
  return new Date(value).toISOString();
}

function textOrNull(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// Solo lo que se guarda en lead.appointment, con tipos y largos acotados.
// Los datos del asistente se guardan como información de la cita, nunca se
// usan para identificar el lead.
function parseBookingCreated(payload) {
  if (!isPlainObject(payload)) return { error: "payload" };
  if (typeof payload.uid !== "string" || !UID_RE.test(payload.uid)) return { error: "payload.uid" };
  let startTime, endTime;
  try {
    startTime = isoDateOrNull(payload.startTime);
    endTime = isoDateOrNull(payload.endTime);
  } catch {
    return { error: "payload.startTime/endTime" };
  }
  const attendee = Array.isArray(payload.attendees) && isPlainObject(payload.attendees[0]) ? payload.attendees[0] : {};
  const rawEmail = typeof attendee.email === "string" ? attendee.email.trim().toLowerCase() : "";
  return {
    booking: {
      uid: payload.uid,
      startTime,
      endTime,
      attendeeName: textOrNull(attendee.name, MAX_NAME),
      attendeeEmail: rawEmail.length <= 254 && EMAIL_RE.test(rawEmail) ? rawEmail : null,
      location: textOrNull(payload.location, MAX_TEXT),
    },
    metadata: payload.metadata,
  };
}

// Todo en una transacción: idempotencia por uid, tenant, estado permitido y
// las escrituras (lead + registro de la reserva + eventos). Un reintento de
// Cal.com con el mismo uid no escribe nada.
async function applyBookingCreated(db, { leadId, companyId, booking }) {
  const bookingRef = db.collection(COLLECTIONS.BOOKINGS).doc(booking.uid);
  const leadRef = db.collection(COLLECTIONS.LEADS).doc(leadId);
  const events = db.collection(COLLECTIONS.EVENTS);

  return db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    const leadSnap = await tx.get(leadRef);

    if (bookingSnap.exists) return { result: "duplicate" };
    if (!leadSnap.exists) return { result: "ignored_lead_not_found" };

    const lead = leadSnap.data();
    // El token ya liga leadId+companyId; esto además exige que el lead
    // guardado sea de esa empresa (companyId es inmutable).
    if (lead.companyId !== companyId) return { result: "rejected_tenant_mismatch" };

    const record = {
      uid: booking.uid,
      leadId,
      companyId,
      startTime: booking.startTime,
      endTime: booking.endTime,
      receivedAt: FieldValue.serverTimestamp(),
      leadStatusAtBooking: lead.status || null,
    };

    if (!BOOKABLE_STATUSES.includes(lead.status)) {
      tx.set(bookingRef, { ...record, outcome: "not_applied" });
      return { result: "not_applied_status", status: lead.status || null };
    }

    const becomesBooked = lead.status !== LEAD_STATUS.APPOINTMENT_BOOKED;
    const update = {
      appointment: {
        calBookingUid: booking.uid,
        startTime: booking.startTime,
        endTime: booking.endTime,
        attendeeName: booking.attendeeName,
        attendeeEmail: booking.attendeeEmail,
        location: booking.location,
        confirmedAt: FieldValue.serverTimestamp(),
      },
      "followUp.stopped": true,
      "followUp.stopReason": "appointment_booked",
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (becomesBooked) update.status = LEAD_STATUS.APPOINTMENT_BOOKED;

    tx.update(leadRef, update);
    tx.set(bookingRef, { ...record, outcome: "applied" });
    tx.set(events.doc(), buildEventDoc({
      leadId, companyId, type: EVENT_TYPE.BOOKING_CONFIRMED, actor: "system:cal_webhook",
      detail: { calBookingUid: booking.uid, startTime: booking.startTime },
    }));
    if (becomesBooked) {
      tx.set(events.doc(), buildEventDoc({
        leadId, companyId, type: EVENT_TYPE.STATUS_CHANGE,
        fromStatus: lead.status || null, toStatus: LEAD_STATUS.APPOINTMENT_BOOKED, actor: "system:cal_webhook",
      }));
    }
    return { result: becomesBooked ? "applied" : "applied_additional_booking" };
  });
}

exports.leadflowCalBookingWebhook = onRequest({ secrets: [CAL_WEBHOOK_SECRET, BOOKING_TOKEN_SECRET] }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  if (!isValidCalSignature(req, CAL_WEBHOOK_SECRET.value())) {
    console.error("Firma X-Cal-Signature-256 inválida o ausente — payload rechazado.");
    return res.status(401).send("Invalid signature");
  }

  const body = req.body;
  if (!isPlainObject(body) || typeof body.triggerEvent !== "string" || !body.triggerEvent) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  if (!SUPPORTED_EVENTS.includes(body.triggerEvent)) {
    // PING, BOOKING_CANCELLED, BOOKING_RESCHEDULED, etc. — ver TODO arriba.
    return res.status(200).json({ result: "ignored_unsupported_event" });
  }

  const parsed = parseBookingCreated(body.payload);
  if (parsed.error) {
    return res.status(400).json({ error: `Invalid field: ${parsed.error}` });
  }
  const { booking } = parsed;

  try {
    const link = verifyBookingMetadata(parsed.metadata);
    if (!link.ok) {
      // Reserva auténtica de Cal.com que no salió de un link firmado (o con
      // metadata manipulada): no se identifica ningún lead.
      console.warn(`Reserva ${booking.uid} sin vínculo verificable (${link.reason}) — no se modifica ningún lead.`);
      return res.status(200).json({ result: "ignored_unlinked_booking" });
    }

    const outcome = await applyBookingCreated(getFirestore(), { leadId: link.leadId, companyId: link.companyId, booking });
    if (outcome.result !== "applied" && outcome.result !== "applied_additional_booking") {
      console.warn(`Reserva ${booking.uid} (lead ${link.leadId}, empresa ${link.companyId}): ${outcome.result}${outcome.status ? ` (${outcome.status})` : ""}`);
    }
    return res.status(200).json({ result: outcome.result });
  } catch (error) {
    // Transitorio (Firestore) o de configuración (secreto): 500 para que
    // Cal.com pueda reintentar — la idempotencia por uid lo hace seguro.
    console.error(`Error procesando la reserva ${booking.uid} de Cal.com:`, error);
    return res.status(500).json({ error: "Internal error" });
  }
});

module.exports.BOOKABLE_STATUSES = BOOKABLE_STATUSES;
