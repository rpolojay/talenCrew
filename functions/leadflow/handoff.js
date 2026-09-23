const { FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS } = require("./constants");
const { sendEmail, buildFrom } = require("./sendEmail");

const DASHBOARD_URL = "https://leadflow.veloiapp.com/leadflow.html";

// La notificación es interna (para el equipo/admin de LeadFlow), no para
// el lead ni para el cliente final, así que siempre sale en español sin
// importar company.language.
const TRIGGER_LABELS = {
  AI_LOW_CONFIDENCE: "La IA no tiene suficiente confianza para responder",
  SENSITIVE_TOPIC: "Tema sensible",
  PRICE_NEGOTIATION: "Negociación de precio",
  CUSTOMER_REQUEST: "El cliente pidió hablar con una persona",
  BUSINESS_RULE: "Regla de negocio",
};

// capture.js guarda recommendedNextAction en inglés (así lo muestra el
// dashboard); aquí solo se traduce para el email. Un texto desconocido se
// envía tal cual.
const ACTION_LABELS = {
  "Review the conversation and follow up personally.":
    "Revisa la conversación y haz el seguimiento personalmente.",
  "Review this lead manually — the automated analysis could not be completed.":
    "Revisa este lead manualmente — el análisis automático no se pudo completar.",
  "Reply to this lead personally — the automatic reply could not be generated.":
    "Responde a este lead personalmente — no se pudo generar la respuesta automática.",
};

// Un handoff en cualquiera de estos estados sigue "abierto": alguien del
// equipo todavía tiene que atenderlo (o ya lo está atendiendo).
const OPEN_HANDOFF_STATUSES = ["OPEN", "ACKNOWLEDGED"];

// Los datos del lead vienen de un formulario público: sin saltos de línea
// en el asunto y con largo acotado.
function oneLine(value, max) {
  const s = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function notificationRecipients(company) {
  const users = Array.isArray(company?.allowedUsers) ? company.allowedUsers : [];
  return users.filter((u) => typeof u === "string" && u.includes("@"));
}

function buildNotification({ lead, triggeredBy, reason, recommendedNextAction }) {
  const contact = lead.contact || {};
  const name = oneLine(contact.name, 80) || oneLine(contact.email || contact.phone, 80) || "Lead sin nombre";
  const contactLine = [contact.email, contact.phone].filter(Boolean).join(" · ");

  const text = [
    "La IA escaló un lead a una persona. Detalles del caso:",
    "",
    `Lead: ${name}`,
    contactLine ? `Contacto: ${contactLine}` : null,
    `Motivo: ${TRIGGER_LABELS[triggeredBy] || triggeredBy}`,
    reason ? `Detalle: ${reason}` : null,
    `Acción recomendada: ${ACTION_LABELS[recommendedNextAction] || recommendedNextAction}`,
    "",
    "Mensaje:",
    lead.message || "",
    "",
    "Atiéndelo en el dashboard:",
    DASHBOARD_URL,
  ].filter((line) => line !== null).join("\n");

  return { subject: `⚠️ Nuevo caso requiere atención: ${name}`, text };
}

// Fase 2.8 — el humano recibe: datos del lead, mensaje, análisis de IA,
// score, motivo, acción recomendada. Todo congelado en `snapshot` para que
// el dashboard no dependa de reconstruirlo desde leadflow_leads después.
//
// Además del dashboard, se notifica por email a los allowedUsers de la
// empresa. El handoff se guarda primero (notificationSent: false) y el email
// se envía después: si Resend falla o la empresa no tiene allowedUsers, el
// handoff igual queda visible en el dashboard y el motivo queda en
// notificationError.
//
// Idempotente: como máximo un handoff abierto por lead. Si el lead ya tiene
// uno OPEN/ACKNOWLEDGED (reintento de la misma captura, o el lead volvió a
// escribir antes de que alguien lo atendiera) se devuelve ese, sin crear otro
// ni volver a notificar. Uno ya RESOLVED no cuenta: si el lead vuelve a
// necesitar a alguien, se abre uno nuevo.
//
// Concurrencia: la búsqueda y la creación van en una transacción que además
// lee y escribe el doc del lead (lastHandoffId). Dos capturas simultáneas del
// mismo lead escriben ese mismo doc, así que Firestore las serializa: la
// segunda se reintenta y ya ve el handoff de la primera. No depende de que el
// query sobre leadflow_handoffs bloquee docs que todavía no existen.
//
// Devuelve { handoffId, created }.
async function createHandoff(db, { leadId, companyId, company, lead, analysis, score, triggeredBy, reason, recommendedNextAction }) {
  const handoffs = db.collection(COLLECTIONS.HANDOFFS);
  const leadRef = db.collection(COLLECTIONS.LEADS).doc(leadId);
  const { handoffId, created } = await db.runTransaction(async (tx) => {
    await tx.get(leadRef);
    const existing = await tx.get(handoffs.where("leadId", "==", leadId));
    const open = existing.docs.find((d) =>
      d.data().companyId === companyId && OPEN_HANDOFF_STATUSES.includes(d.data().status));
    if (open) return { handoffId: open.id, created: false };

    const newRef = handoffs.doc();
    tx.set(newRef, {
      leadId,
      companyId,
      createdAt: FieldValue.serverTimestamp(),
      triggeredBy,
      reason,
      recommendedNextAction,
      snapshot: {
        contact: lead.contact,
        message: lead.message,
        analysis: analysis || null,
        score: score || null,
      },
      status: "OPEN",
      resolvedBy: null,
      resolvedAt: null,
      notificationSent: false,
    });
    tx.update(leadRef, { lastHandoffId: newRef.id });
    return { handoffId: newRef.id, created: true };
  });

  if (created) await notifyHandoff(handoffs.doc(handoffId), { leadId, companyId, company, lead, triggeredBy, reason, recommendedNextAction });
  return { handoffId, created };
}

async function notifyHandoff(ref, { leadId, companyId, company, lead, triggeredBy, reason, recommendedNextAction }) {
  try {
    const recipients = notificationRecipients(company);
    if (recipients.length === 0) {
      console.error(`Handoff ${ref.id} (empresa ${companyId}) sin allowedUsers — no se envió notificación por email`);
      await ref.update({ notificationError: "no_allowed_users" });
      return;
    }

    const { subject, text } = buildNotification({ lead, triggeredBy, reason, recommendedNextAction });
    // Remitente "LeadFlow": es la plataforma avisándole a la empresa, no la
    // empresa escribiéndose a sí misma.
    const result = await sendEmail({
      from: buildFrom(null),
      to: recipients,
      subject,
      text,
      logContext: `handoff ${ref.id} lead ${leadId}`,
    });
    await ref.update({
      notificationSent: result.sentAt !== null,
      notificationSentAt: result.sentAt,
      notificationEmailId: result.emailId,
      notificationError: result.error,
    });
  } catch (err) {
    // Solo llega aquí si falla la escritura en Firestore — el handoff ya
    // existe, así que no se rompe la captura.
    console.error(`Error registrando la notificación del handoff ${ref.id}:`, err);
  }
}

module.exports = { createHandoff, buildNotification, OPEN_HANDOFF_STATUSES };
