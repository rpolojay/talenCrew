const { FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS } = require("./constants");

// Fase 2.8 — el humano recibe: datos del lead, mensaje, análisis de IA,
// score, motivo, acción recomendada. Todo congelado en `snapshot` para que
// el dashboard no dependa de reconstruirlo desde leadflow_leads después.
//
// TODO BLOQUEANTE antes de conectar un cliente real (igual criterio que la
// validación de firma HMAC de Meta en whatsappWebhook): notificationSent
// queda hardcodeado en false porque en v1 el handoff SOLO es visible en el
// dashboard (dashboard/leadflow.html), sin ningún canal de notificación
// activo. Un handoff que nadie ve a tiempo es un riesgo de negocio directo.
async function createHandoff(db, { leadId, companyId, lead, analysis, score, triggeredBy, reason, recommendedNextAction }) {
  const ref = await db.collection(COLLECTIONS.HANDOFFS).add({
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
  return ref.id;
}

module.exports = { createHandoff };
