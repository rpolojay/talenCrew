const { FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS, LEAD_STATUS, HANDOFF_TRIGGER } = require("./constants");
const { resolveHandoffRules, isBelowConfidenceThreshold } = require("./handoffRules");
const { isAllowedBookingUrl } = require("./bookingToken");
const { isBookingAutomationHealthy } = require("./bookingIntegration");

// El análisis de IA solo devuelve needs_human + un texto libre en `reason`,
// sin categoría — el trigger del handoff se deduce del texto. Solo es la
// etiqueta del caso (la decisión de escalar ya se tomó): precio primero,
// como siempre; después pedido explícito de hablar con una persona; después
// un tema sensible de la empresa (handoffRules, o los de por defecto); si
// nada coincide, AI_LOW_CONFIDENCE.
const HUMAN_REQUEST_RE = new RegExp([
  String.raw`\b(?:talk|speak|chat|call|contact|connect)\w*\b[^.]{0,30}\b(?:person|human|someone|somebody|representative|agent|staff|team member)\b`,
  String.raw`\b(?:ask|asks|asked|asking|request|requests|requested|want|wants|wanted|need|needs)\b[^.]{0,20}\b(?:person|human|representative|agent)\b`,
  String.raw`\b(?:real|actual|live) (?:person|human)\b`,
  String.raw`\b(?:hablar|conversar|comunicarse)\b[^.]{0,30}\b(?:persona|alguien|humano|asesor|agente)\b`,
  String.raw`\bpersona real\b`,
].join("|"), "i");

function triggerForReason(reason, company = null) {
  const r = (reason || "").toLowerCase();
  if (r.includes("price") || r.includes("negotiat")) return HANDOFF_TRIGGER.PRICE_NEGOTIATION;
  if (HUMAN_REQUEST_RE.test(r)) return HANDOFF_TRIGGER.CUSTOMER_REQUEST;
  if (resolveHandoffRules(company).sensitiveTopics.some((t) => r.includes(t.toLowerCase()))) return HANDOFF_TRIGGER.SENSITIVE_TOPIC;
  return HANDOFF_TRIGGER.AI_LOW_CONFIDENCE;
}

// ¿Este análisis tiene que ir a una persona? null si no; si sí, el
// { triggeredBy, reason } con el que se abre el handoff. Aplica
// handoffRules.lowConfidenceThreshold de la empresa (ver ./handoffRules.js);
// los demás campos de handoffRules actúan dentro del prompt, a través de
// analysis.needs_human.
function humanReviewDecision(analysis, company) {
  if (analysis.needs_human) {
    return { triggeredBy: triggerForReason(analysis.reason, company), reason: analysis.reason };
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
    // Empresas sin bookingLink (el link es opcional en signup.html), con uno
    // fuera de la allowlist de proveedores (./bookingToken.js), o cuya
    // integración de reservas no está VERIFIED (./bookingIntegration.js —
    // tener un link no prueba que LeadFlow se entere de las reservas): el
    // lead califica igual, pero la respuesta promete contacto del equipo en
    // vez de un link, y no entra al flujo de follow-ups de BOOKING_SENT.
    // QUALIFIED es la ÚNICA ruta en la que el código agrega el link.
    return isAllowedBookingUrl(company.bookingLink) && isBookingAutomationHealthy(company) ? "QUALIFIED" : "QUALIFIED_NO_BOOKING";
  }
  return "NEEDS_INFO"; // fallback conservador: nunca empuja booking si el score no alcanza
}

// La empresa tiene un bookingLink configurado pero fuera de la allowlist: se
// trata como sin link (nunca se envía), y capture.js lo deja registrado.
function hasRejectedBookingLink(company) {
  return Boolean(company?.bookingLink) && !isAllowedBookingUrl(company.bookingLink);
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

// Esquema único de leadflow_lead_events. buildEventDoc se usa también dentro
// de transacciones (booking.js), donde no se puede llamar a logEvent.
function buildEventDoc({ leadId, companyId, type, fromStatus = null, toStatus = null, actor, detail = null }) {
  return {
    leadId,
    companyId,
    type,
    fromStatus,
    toStatus,
    actor,
    detail,
    timestamp: FieldValue.serverTimestamp(),
  };
}

async function logEvent(db, event) {
  await db.collection(COLLECTIONS.EVENTS).add(buildEventDoc(event));
}

module.exports = { decideRoute, humanReviewDecision, triggerForReason, statusForRoute, logEvent, buildEventDoc, hasRejectedBookingLink, ROUTE_STATUS };
