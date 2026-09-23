const { FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS, LEAD_STATUS, HANDOFF_TRIGGER } = require("./constants");
const { resolveHandoffRules, isBelowConfidenceThreshold } = require("./handoffRules");

// El análisis de IA solo devuelve needs_human + un texto libre en `reason`,
// sin categoría — el trigger del handoff se deduce del texto (mismo criterio
// que capture.js tenía inline).
function triggerForReason(reason) {
  const r = (reason || "").toLowerCase();
  return r.includes("price") || r.includes("negotiat")
    ? HANDOFF_TRIGGER.PRICE_NEGOTIATION
    : HANDOFF_TRIGGER.AI_LOW_CONFIDENCE;
}

// ¿Este análisis tiene que ir a una persona? null si no; si sí, el
// { triggeredBy, reason } con el que se abre el handoff. Aplica
// handoffRules.lowConfidenceThreshold de la empresa (ver ./handoffRules.js);
// los demás campos de handoffRules actúan dentro del prompt, a través de
// analysis.needs_human.
function humanReviewDecision(analysis, company) {
  if (analysis.needs_human) {
    return { triggeredBy: triggerForReason(analysis.reason), reason: analysis.reason };
  }
  const rules = resolveHandoffRules(company);
  if (isBelowConfidenceThreshold(analysis, rules)) {
    return {
      triggeredBy: HANDOFF_TRIGGER.AI_LOW_CONFIDENCE,
      reason: `AI confidence ${analysis.confidence} is below this company's threshold (${rules.lowConfidenceThreshold}). ${analysis.reason || ""}`.trim(),
    };
  }
  return null;
}

// Decisión de ruta en CÓDIGO, no en el prompt — auditable y no depende de
// que la IA "decida bien" cada vez (Step 6.1 paso 4).
function decideRoute({ analysis, score, company }) {
  if (humanReviewDecision(analysis, company)) return "NEEDS_HUMAN";
  if (analysis.qualification === "unqualified" && !score.inServiceArea) return "OUT_OF_AREA";
  if (analysis.qualification === "needs_more_info") return "NEEDS_INFO";
  if (analysis.qualification === "unqualified") return "LOW_INTENT";

  const minScore = company.scoringRules?.minScoreToQualify ?? 60;
  if (score.adjusted >= minScore) {
    // Empresas sin bookingLink (el link es opcional en signup.html): el lead
    // califica igual, pero la respuesta promete contacto del equipo en vez
    // de un link, y no entra al flujo de follow-ups de BOOKING_SENT.
    return company.bookingLink ? "QUALIFIED" : "QUALIFIED_NO_BOOKING";
  }
  return "NEEDS_INFO"; // fallback conservador: nunca empuja booking si el score no alcanza
}

const ROUTE_STATUS = {
  QUALIFIED: LEAD_STATUS.BOOKING_SENT,
  QUALIFIED_NO_BOOKING: LEAD_STATUS.CONTACTED,
  NEEDS_INFO: LEAD_STATUS.CONTACTED,
  OUT_OF_AREA: LEAD_STATUS.CONTACTED,
  LOW_INTENT: LEAD_STATUS.CONTACTED,
  NEEDS_HUMAN: LEAD_STATUS.HUMAN_REVIEW,
};

function statusForRoute(route) {
  return ROUTE_STATUS[route] || LEAD_STATUS.CONTACTED;
}

async function logEvent(db, { leadId, companyId, type, fromStatus = null, toStatus = null, actor, detail = null }) {
  await db.collection(COLLECTIONS.EVENTS).add({
    leadId,
    companyId,
    type,
    fromStatus,
    toStatus,
    actor,
    detail,
    timestamp: FieldValue.serverTimestamp(),
  });
}

module.exports = { decideRoute, humanReviewDecision, triggerForReason, statusForRoute, logEvent, ROUTE_STATUS };
