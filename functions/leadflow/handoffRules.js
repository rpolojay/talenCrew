// Lectura validada de leadflow_companies.handoffRules — el formato que ya
// escribe trialSignup.js (defaultCompanyConfig):
//   { lowConfidenceThreshold, sensitiveTopics, escalateOnPriceNegotiation,
//     escalateOnExplicitHumanRequest }
//
// Una empresa sin handoffRules (o con un campo inválido) se comporta
// exactamente como antes de que existiera esta lectura: sin umbral de
// confianza, y con el mismo criterio de needs_human que tenía el prompt de
// analyzeLead.js escrito a mano.

const DEFAULT_SENSITIVE_TOPICS = ["legal", "injury", "insurance dispute"];
const MAX_TOPICS = 20;
const MAX_TOPIC_LENGTH = 60;

// Los temas se interpolan en el prompt dentro de "(a, b, c)": solo letras,
// números, espacios y ' & / - — nada de saltos de línea, comillas, comas,
// paréntesis ni puntuación que pueda cerrar la lista o abrir otra regla — y
// con tope de cantidad y largo.
const DISALLOWED_TOPIC_CHARS = /[^\p{L}\p{N} '&/-]+/gu;

function cleanTopics(raw) {
  return raw
    .filter((t) => typeof t === "string")
    .map((t) => t.replace(DISALLOWED_TOPIC_CHARS, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t && t.length <= MAX_TOPIC_LENGTH)
    .slice(0, MAX_TOPICS);
}

function resolveHandoffRules(company) {
  const rules = {
    lowConfidenceThreshold: null,
    sensitiveTopics: DEFAULT_SENSITIVE_TOPICS,
    escalateOnPriceNegotiation: true,
    escalateOnExplicitHumanRequest: true,
  };
  const raw = company?.handoffRules;
  if (!raw || typeof raw !== "object") return rules;

  const threshold = raw.lowConfidenceThreshold;
  if (typeof threshold === "number" && threshold > 0 && threshold <= 1) {
    rules.lowConfidenceThreshold = threshold;
  }

  // [] es una decisión explícita (ningún tema escala); una lista con solo
  // valores inválidos se trata como ausente y cae al default.
  if (Array.isArray(raw.sensitiveTopics)) {
    const topics = cleanTopics(raw.sensitiveTopics);
    if (topics.length > 0 || raw.sensitiveTopics.length === 0) rules.sensitiveTopics = topics;
  }

  if (typeof raw.escalateOnPriceNegotiation === "boolean") {
    rules.escalateOnPriceNegotiation = raw.escalateOnPriceNegotiation;
  }
  if (typeof raw.escalateOnExplicitHumanRequest === "boolean") {
    rules.escalateOnExplicitHumanRequest = raw.escalateOnExplicitHumanRequest;
  }
  return rules;
}

function isBelowConfidenceThreshold(analysis, rules) {
  return rules.lowConfidenceThreshold !== null &&
    typeof analysis?.confidence === "number" &&
    analysis.confidence < rules.lowConfidenceThreshold;
}

function joinWithOr(parts) {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} or ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, or ${parts[parts.length - 1]}`;
}

// Línea del prompt que define needs_human (analyzeLead.js y
// detectLanguage.js). Con las reglas por defecto produce exactamente el
// texto que analyzeLead.js tenía escrito a mano.
function buildNeedsHumanCriterion(rules) {
  const parts = [];
  if (rules.sensitiveTopics.length > 0) parts.push(`a sensitive topic (${rules.sensitiveTopics.join(", ")})`);
  if (rules.escalateOnPriceNegotiation) parts.push("a price negotiation");
  if (rules.escalateOnExplicitHumanRequest) parts.push("an explicit request to talk to a person");

  if (parts.length === 0) {
    return `- "needs_human" = false. This business has disabled automatic escalation to a human.`;
  }
  return `- "needs_human" = true if the message involves ${joinWithOr(parts)}.`;
}

module.exports = {
  resolveHandoffRules,
  isBelowConfidenceThreshold,
  buildNeedsHumanCriterion,
  DEFAULT_SENSITIVE_TOPICS,
};
