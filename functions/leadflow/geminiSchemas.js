const { Type } = require("@google/genai");

const INTENT_VALUES = ["high", "medium", "low"];
const QUALIFICATION_VALUES = ["qualified", "needs_more_info", "unqualified"];
const DETECTED_LANGUAGE_VALUES = ["en", "es"];

// Salida estricta de la llamada #1 (análisis). Se le pasa a Gemini como
// responseSchema para forzar JSON válido, y además se revalida a mano en
// validateAnalysis() antes de confiar en el resultado para decisiones
// automáticas — no basta con que Gemini "prometa" respetar el schema.
const LEAD_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    intent: { type: Type.STRING, enum: INTENT_VALUES },
    service: { type: Type.STRING },
    location: { type: Type.STRING },
    urgency: { type: Type.STRING, enum: INTENT_VALUES },
    qualification: { type: Type.STRING, enum: QUALIFICATION_VALUES },
    lead_score: { type: Type.NUMBER },
    reason: { type: Type.STRING },
    needs_human: { type: Type.BOOLEAN },
    confidence: { type: Type.NUMBER },
    detected_language: { type: Type.STRING, enum: DETECTED_LANGUAGE_VALUES },
  },
  required: [
    "intent", "service", "location", "urgency", "qualification",
    "lead_score", "reason", "needs_human", "confidence",
  ],
};

function validateAnalysis(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Analysis output is not an object");
  }
  if (!INTENT_VALUES.includes(data.intent)) {
    throw new Error(`Invalid intent: ${data.intent}`);
  }
  if (typeof data.service !== "string") {
    throw new Error("Invalid service");
  }
  if (typeof data.location !== "string") {
    throw new Error("Invalid location");
  }
  if (!INTENT_VALUES.includes(data.urgency)) {
    throw new Error(`Invalid urgency: ${data.urgency}`);
  }
  if (!QUALIFICATION_VALUES.includes(data.qualification)) {
    throw new Error(`Invalid qualification: ${data.qualification}`);
  }
  if (typeof data.lead_score !== "number" || data.lead_score < 0 || data.lead_score > 100) {
    throw new Error(`Invalid lead_score: ${data.lead_score}`);
  }
  if (typeof data.reason !== "string") {
    throw new Error("Invalid reason");
  }
  if (typeof data.needs_human !== "boolean") {
    throw new Error("Invalid needs_human");
  }
  if (typeof data.confidence !== "number" || data.confidence < 0 || data.confidence > 1) {
    throw new Error(`Invalid confidence: ${data.confidence}`);
  }
  // No es requerido ni bloqueante — si Gemini lo omite o devuelve un valor
  // fuera de DETECTED_LANGUAGE_VALUES, se trata como ambiguo (null) y
  // generateReply() cae de vuelta a company.language, en vez de fallar todo
  // el análisis por un campo que es solo un hint de idioma.
  data.detected_language = DETECTED_LANGUAGE_VALUES.includes(data.detected_language)
    ? data.detected_language
    : null;
  return data;
}

module.exports = { LEAD_ANALYSIS_SCHEMA, validateAnalysis, DETECTED_LANGUAGE_VALUES };
