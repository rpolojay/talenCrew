const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

const { COLLECTIONS, LEAD_STATUS, EVENT_TYPE } = require("./constants");
const { CAL_WEBHOOK_SECRET } = require("./secrets");
const { logEvent } = require("./pipeline");

// Step 3 del diseño original. Cal.com no tiene handshake de verificación
// (a diferencia del webhook de Meta): el secreto se configura una sola vez
// al crear el webhook en la cuenta de Cal.com, y cada POST viene firmado
// con el header X-Cal-Signature-256 (HMAC-SHA256 hex del body CRUDO,
// firmado con ese mismo secreto). Mismo patrón de comparación en tiempo
// constante que isValidMetaSignature en el index.js principal, pero
// self-contained aquí — LeadFlow no comparte código con whatsappWebhook.
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

// El leadId viaja en el link de reserva como `metadata[leadId]=xxx` (ver
// buildBookingLink en capture.js) — Cal.com lo guarda en booking.metadata y
// lo reenvía tal cual en el payload del webhook.
function extractLeadId(payload) {
  const fromMetadata = payload?.metadata?.leadId;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;
  return null;
}

// Fallback si el lead agendó sin pasar por el link con metadata (ej. copió
// el link pelado, o Cal.com lo despojó en algún paso intermedio) — busca
// por el email o teléfono del primer asistente, tal como sugirió el pedido
// original ("por el nombre o algún identificador"). Es una búsqueda global
// (Admin SDK, sin filtrar por companyId, porque en este punto todavía no
// sabemos a qué empresa pertenece la reserva); si dos empresas tuvieran un
// lead con el mismo contacto podría matchear el equivocado — riesgo
// aceptado en v1, con un solo tenant demo activo.
async function findLeadByAttendee(db, attendee) {
  if (!attendee) return null;

  if (attendee.email) {
    const snap = await db.collection(COLLECTIONS.LEADS)
      .where("contact.email", "==", attendee.email)
      .get();
    if (!snap.empty) return pickMostRecent(snap);
  }

  if (attendee.phone) {
    const snap = await db.collection(COLLECTIONS.LEADS)
      .where("contact.phone", "==", attendee.phone)
      .get();
    if (!snap.empty) return pickMostRecent(snap);
  }

  return null;
}

function pickMostRecent(snap) {
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  docs.sort((a, b) => (b.capturedAt?.toMillis?.() ?? 0) - (a.capturedAt?.toMillis?.() ?? 0));
  return docs[0];
}

exports.leadflowCalBookingWebhook = onRequest({ secrets: [CAL_WEBHOOK_SECRET] }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  if (!isValidCalSignature(req, CAL_WEBHOOK_SECRET.value())) {
    console.error("Firma X-Cal-Signature-256 inválida o ausente — payload rechazado.");
    return res.status(401).send("Invalid signature");
  }

  // Cal.com espera un 200 rápido y reintenta (o puede deshabilitar el
  // webhook) si no lo recibe — mismo criterio defensivo que whatsappWebhook:
  // una vez la firma es válida, cualquier error interno también responde
  // 200 en vez de propagar el error.
  try {
    const triggerEvent = req.body?.triggerEvent;
    const payload = req.body?.payload;

    if (triggerEvent !== "BOOKING_CREATED") {
      // BOOKING_CANCELLED / BOOKING_RESCHEDULED / etc. quedan deliberadamente
      // fuera de este bloque — se agregan aparte si el negocio los necesita.
      return res.status(200).send("EVENT_RECEIVED");
    }

    const db = getFirestore();
    const leadId = extractLeadId(payload);
    const attendee = payload?.attendees?.[0];

    let leadDoc = null;
    if (leadId) {
      const snap = await db.collection(COLLECTIONS.LEADS).doc(leadId).get();
      if (snap.exists) leadDoc = { id: snap.id, ...snap.data() };
    }
    if (!leadDoc) {
      leadDoc = await findLeadByAttendee(db, {
        email: attendee?.email || null,
        phone: attendee?.phone || attendee?.phoneNumber || null,
      });
    }

    if (!leadDoc) {
      console.error("No se encontró ningún lead para la reserva de Cal.com:", payload?.uid);
      return res.status(200).send("EVENT_RECEIVED");
    }

    const appointment = {
      calBookingUid: payload?.uid || null,
      startTime: payload?.startTime || null,
      endTime: payload?.endTime || null,
      attendeeName: attendee?.name || null,
      attendeeEmail: attendee?.email || null,
      location: payload?.location || null,
      confirmedAt: FieldValue.serverTimestamp(),
    };

    const leadRef = db.collection(COLLECTIONS.LEADS).doc(leadDoc.id);
    const fromStatus = leadDoc.status || null;

    await leadRef.update({
      status: LEAD_STATUS.APPOINTMENT_BOOKED,
      appointment,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logEvent(db, {
      leadId: leadDoc.id,
      companyId: leadDoc.companyId,
      type: EVENT_TYPE.BOOKING_CONFIRMED,
      actor: "system:cal_webhook",
      detail: { calBookingUid: appointment.calBookingUid, startTime: appointment.startTime },
    });
    await logEvent(db, {
      leadId: leadDoc.id,
      companyId: leadDoc.companyId,
      type: EVENT_TYPE.STATUS_CHANGE,
      fromStatus,
      toStatus: LEAD_STATUS.APPOINTMENT_BOOKED,
      actor: "system:cal_webhook",
    });

    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Error procesando webhook de Cal.com:", error);
    return res.status(200).send("EVENT_RECEIVED");
  }
});
