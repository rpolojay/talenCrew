const { FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS, LEAD_STATUS, EVENT_TYPE, HANDOFF_TRIGGER } = require("./constants");
const { buildEventDoc, logEvent } = require("./pipeline");
const { createHandoff, notifyReviewMessage, findOpenHandoffs } = require("./handoff");

// HUMAN_REVIEW es un estado de control humano: mientras el lead está en
// HUMAN_REVIEW, o tiene un handoff abierto (./handoff.js findOpenHandoffs),
// la automatización no lo toca — ni Gemini, ni respuesta al lead, ni link de
// reserva, ni follow-ups. Solo sale por una acción explícita de una persona
// autorizada (resumeAutomation / leadflowResumeAutomation, o moviendo la
// tarjeta en el dashboard).

// Mínimo entre dos avisos al equipo por mensajes nuevos del mismo handoff:
// el primer mensaje avisa (o el aviso de creación del handoff cuenta), los
// siguientes dentro de la ventana solo quedan guardados.
const REVIEW_MESSAGE_NOTIFY_INTERVAL_MS = 15 * 60 * 1000;

const REVIEW_HANDOFF_REASON = "The lead sent a new message while under human review, so no automatic reply was sent.";
const REVIEW_HANDOFF_ACTION = "Review the conversation and follow up personally.";

// Marca de control humano que solo escribe el backend: se prende en cada
// entrada a HUMAN_REVIEW (enterHumanReviewFields) y solo se apaga en
// resumeAutomation. El navegador puede cambiar lead.status (firestore.rules:
// isLeadflowLeadStatusUpdate) pero NO este campo, así que mover la tarjeta
// fuera de HUMAN_REVIEW sin pasar por leadflowResumeAutomation no devuelve el
// lead a la automatización.
function enterHumanReviewFields() {
  return {
    status: LEAD_STATUS.HUMAN_REVIEW,
    "humanControl.active": true,
    "humanControl.since": FieldValue.serverTimestamp(),
  };
}

// ÚNICA definición de "lead en revisión humana".
function isUnderHumanReview(lead, openHandoffs) {
  return lead?.status === LEAD_STATUS.HUMAN_REVIEW ||
    lead?.humanControl?.active === true ||
    (openHandoffs?.length ?? 0) > 0;
}

// Lectura (sin transacción) justo antes de enviar una respuesta automática:
// otra captura concurrente pudo haber pasado el lead a revisión humana
// mientras la IA escribía.
async function leadUnderHumanReview(db, leadId, companyId) {
  const snap = await db.collection(COLLECTIONS.LEADS).doc(leadId).get();
  if (!snap.exists) return false;
  return isUnderHumanReview(snap.data(), await findOpenHandoffs(db, leadId, companyId));
}

// Escritura final de la respuesta automática (capture.js). En una transacción
// que relee el lead y sus handoffs abiertos: si mientras tanto el lead pasó a
// revisión humana, se guarda todo MENOS el estado — ninguna respuesta de la IA
// saca a un lead de HUMAN_REVIEW. Devuelve { status, locked }.
async function writeAutomatedResult(db, { leadId, companyId, update, nextStatus }) {
  const leadRef = db.collection(COLLECTIONS.LEADS).doc(leadId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(leadRef);
    const current = snap.exists ? snap.data() : {};
    const open = await findOpenHandoffs(db, leadId, companyId, tx);
    const locked = nextStatus !== LEAD_STATUS.HUMAN_REVIEW && isUnderHumanReview(current, open);
    const statusFields = locked ? {}
      : nextStatus === LEAD_STATUS.HUMAN_REVIEW ? enterHumanReviewFields()
      : { status: nextStatus };
    tx.update(leadRef, { ...update, ...statusFields });
    return { status: locked ? current.status : nextStatus, locked };
  });
}

function toMillis(ts) {
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
}

// Último aviso al equipo sobre este handoff: el de un mensaje en revisión o,
// si no hubo, el de su creación.
function lastNotifiedMillis(handoff) {
  return toMillis(handoff.lastMessageNotifiedAt) ?? toMillis(handoff.notificationSentAt) ?? toMillis(handoff.createdAt);
}

// Mensaje adicional de un lead: si está en revisión humana lo guarda para la
// persona a cargo y devuelve { handoffId, status }; si no, devuelve null y el
// caller sigue con el flujo automático normal. Se decide dentro de una
// transacción que vuelve a leer el lead y sus handoffs abiertos, ANTES de
// cualquier llamada a Gemini.
async function captureMessageDuringReview(db, { leadId, companyId, company, message }) {
  const leadRef = db.collection(COLLECTIONS.LEADS).doc(leadId);
  const now = Date.now();

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(leadRef);
    if (!snap.exists) return null;
    const lead = snap.data();
    const open = await findOpenHandoffs(db, leadId, companyId, tx);
    if (!isUnderHumanReview(lead, open)) return null;

    const handoff = open[0] || null;
    const last = handoff ? lastNotifiedMillis(handoff.data()) : null;
    const notify = Boolean(handoff) && (last === null || now - last >= REVIEW_MESSAGE_NOTIFY_INTERVAL_MS);

    tx.update(leadRef, {
      lastInboundMessage: { text: message, receivedAt: FieldValue.serverTimestamp(), duringReview: true },
      ...(lead.followUp?.stopped ? {} : { "followUp.stopped": true, "followUp.stopReason": "lead_replied" }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (handoff) {
      tx.update(handoff.ref, {
        lastCustomerMessage: { text: message, receivedAt: FieldValue.serverTimestamp() },
        messagesDuringReview: (handoff.data().messagesDuringReview || 0) + 1,
        ...(notify ? { lastMessageNotifiedAt: FieldValue.serverTimestamp() } : {}),
      });
    }
    tx.set(db.collection(COLLECTIONS.EVENTS).doc(), buildEventDoc({
      leadId, companyId, type: EVENT_TYPE.MESSAGE_RECEIVED_DURING_REVIEW, actor: "system:capture",
      detail: { message, handoffId: handoff?.id ?? null, notified: notify },
    }));
    return { lead, handoffId: handoff?.id ?? null, notify };
  });
  if (!outcome) return null;

  const leadForHandoff = { contact: outcome.lead.contact, message };
  let handoffId = outcome.handoffId;
  if (!handoffId) {
    // En HUMAN_REVIEW sin un caso abierto (p. ej. alguien lo resolvió pero no
    // devolvió el lead a la automatización): se abre uno nuevo para que el
    // mensaje le llegue a una persona. createHandoff es idempotente y avisa.
    const result = await createHandoff(db, {
      leadId, companyId, company, lead: leadForHandoff,
      analysis: outcome.lead.analysis ?? null, score: outcome.lead.score ?? null,
      triggeredBy: HANDOFF_TRIGGER.BUSINESS_RULE, reason: REVIEW_HANDOFF_REASON, recommendedNextAction: REVIEW_HANDOFF_ACTION,
    });
    handoffId = result.handoffId;
    if (result.created) {
      await logEvent(db, { leadId, companyId, type: EVENT_TYPE.HANDOFF_CREATED, actor: "system:human_review", detail: { handoffId } });
    }
  } else if (outcome.notify) {
    await notifyReviewMessage(db, { handoffId, leadId, companyId, company, lead: leadForHandoff, message });
  }
  return { handoffId, status: outcome.lead.status };
}

function resumeError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

// Estados a los que una persona puede devolver un lead al reanudar (p. ej. al
// arrastrar la tarjeta desde HUMAN_REVIEW en el kanban). Nunca BOOKING_SENT
// (reactivaría los follow-ups de reserva), ni estados del pipeline.
const RESUME_TARGET_STATUSES = [
  LEAD_STATUS.CONTACTED, LEAD_STATUS.QUALIFIED, LEAD_STATUS.NURTURE, LEAD_STATUS.APPOINTMENT_BOOKED, LEAD_STATUS.CLOSED,
];

// Devuelve el lead a la automatización. Solo la llama leadflowResumeAutomation
// (./resumeAutomation.js), que ya verificó la identidad de quien la pide y que
// toStatus (opcional) está en RESUME_TARGET_STATUSES.
// En una transacción: relee el lead y su empresa, exige que quien llama sea
// admin o miembro de ESA empresa (si no, NOT_FOUND: no se revela si el lead
// existe), resuelve los handoffs abiertos, apaga humanControl y saca el lead
// de HUMAN_REVIEW a toStatus (por defecto CONTACTED). Sin toStatus, un estado
// distinto de HUMAN_REVIEW se deja como está. Nunca pone BOOKING_SENT.
// Idempotente: si ya no hay nada en revisión no escribe nada.
async function resumeAutomation(db, { leadId, callerEmail, callerIsAdmin, toStatus: requestedStatus = null }) {
  if (requestedStatus !== null && !RESUME_TARGET_STATUSES.includes(requestedStatus)) throw resumeError("INVALID_STATUS");
  const leadRef = db.collection(COLLECTIONS.LEADS).doc(leadId);
  return db.runTransaction(async (tx) => {
    const leadSnap = await tx.get(leadRef);
    if (!leadSnap.exists) throw resumeError("NOT_FOUND");
    const lead = leadSnap.data();
    const companySnap = await tx.get(db.collection(COLLECTIONS.COMPANIES).doc(lead.companyId));
    const members = companySnap.exists && Array.isArray(companySnap.data().allowedUsers)
      ? companySnap.data().allowedUsers.map((u) => String(u).toLowerCase())
      : [];
    if (!callerIsAdmin && !members.includes(callerEmail)) throw resumeError("NOT_FOUND");

    const open = await findOpenHandoffs(db, leadId, lead.companyId, tx);
    if (!isUnderHumanReview(lead, open)) {
      return { changed: false, status: lead.status, resolvedHandoffIds: [] };
    }

    const fromStatus = lead.status;
    const toStatus = requestedStatus ?? (fromStatus === LEAD_STATUS.HUMAN_REVIEW ? LEAD_STATUS.CONTACTED : fromStatus);
    const actor = `user:${callerEmail}`;
    for (const h of open) {
      tx.update(h.ref, {
        status: "RESOLVED", resolvedBy: callerEmail, resolvedAt: FieldValue.serverTimestamp(), resolution: "automation_resumed",
      });
    }
    tx.update(leadRef, {
      status: toStatus,
      humanControl: { active: false, resumedAt: FieldValue.serverTimestamp(), resumedBy: callerEmail },
      automationResumedAt: FieldValue.serverTimestamp(),
      automationResumedBy: callerEmail,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const events = db.collection(COLLECTIONS.EVENTS);
    const resolvedHandoffIds = open.map((h) => h.id);
    tx.set(events.doc(), buildEventDoc({
      leadId, companyId: lead.companyId, type: EVENT_TYPE.AUTOMATION_RESUMED, actor, detail: { resolvedHandoffIds },
    }));
    if (toStatus !== fromStatus) {
      tx.set(events.doc(), buildEventDoc({
        leadId, companyId: lead.companyId, type: EVENT_TYPE.STATUS_CHANGE, fromStatus, toStatus, actor,
      }));
    }
    return { changed: true, fromStatus, status: toStatus, resolvedHandoffIds };
  });
}

module.exports = {
  enterHumanReviewFields,
  isUnderHumanReview,
  leadUnderHumanReview,
  writeAutomatedResult,
  captureMessageDuringReview,
  resumeAutomation,
  RESUME_TARGET_STATUSES,
  REVIEW_MESSAGE_NOTIFY_INTERVAL_MS,
};
