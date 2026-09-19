const { FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS, LEAD_STATUS } = require("./constants");

// Decisión de ruta en CÓDIGO, no en el prompt — auditable y no depende de
// que la IA "decida bien" cada vez (Step 6.1 paso 4).
function decideRoute({ analysis, score, company }) {
  if (analysis.needs_human) return "NEEDS_HUMAN";
  if (analysis.qualification === "unqualified" && !score.inServiceArea) return "OUT_OF_AREA";
  if (analysis.qualification === "needs_more_info") return "NEEDS_INFO";
  if (analysis.qualification === "unqualified") return "LOW_INTENT";

  const minScore = company.scoringRules?.minScoreToQualify ?? 60;
  if (score.adjusted >= minScore) return "QUALIFIED";
  return "NEEDS_INFO"; // fallback conservador: nunca empuja booking si el score no alcanza
}

const ROUTE_STATUS = {
  QUALIFIED: LEAD_STATUS.BOOKING_SENT,
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

module.exports = { decideRoute, statusForRoute, logEvent, ROUTE_STATUS };
