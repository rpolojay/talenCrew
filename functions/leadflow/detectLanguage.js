const { GoogleGenAI, Type } = require("@google/genai");
const { GEMINI_API_KEY } = require("./secrets");
const { DETECTED_LANGUAGE_VALUES } = require("./geminiSchemas");
const { resolveHandoffRules, buildNeedsHumanCriterion } = require("./handoffRules");
const { untrustedBlock, businessProfileBlock, UNTRUSTED_NOTICE, BUSINESS_NOTICE } = require("./promptData");

// Llamada de IA separada de analyzeLead() — se usa en handleAdditionalMessage
// (capture.js), donde el analisis completo (intent/qualification/score) NO
// se vuelve a correr y se conserva del primer mensaje, pero hay dos cosas que
// si dependen de ESTE mensaje:
//   - el IDIOMA (el lead pudo empezar en ingles y seguir en espanol), y
//   - si pide/necesita una persona (ej. el primer mensaje era una consulta
//     normal y el segundo es un reclamo o "quiero hablar con alguien").
// Ambas salen de la misma llamada, con el mismo criterio de needs_human que
// analyzeLead.js (handoffRules de la empresa).
const MESSAGE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    detected_language: { type: Type.STRING, enum: DETECTED_LANGUAGE_VALUES },
    needs_human: { type: Type.BOOLEAN },
    reason: { type: Type.STRING },
  },
  required: ["detected_language", "needs_human", "reason"],
};

const MAX_REASON_LENGTH = 500;

function buildClassificationPrompt(message, company) {
  return `You are screening a new message from an existing lead of the business described in <business_profile> below.

BUSINESS PROFILE:
${businessProfileBlock(company)}
${BUSINESS_NOTICE}

MESSAGE:
${untrustedBlock({ message })}
${UNTRUSTED_NOTICE}

Return structured JSON only, following these rules:
- "detected_language" = the language the message above is written in — "es" for Spanish, "en" for English.
${buildNeedsHumanCriterion(resolveHandoffRules(company))}
- "reason" = one short sentence explaining the needs_human decision.`;
}

async function classifyAdditionalMessage(message, company) {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: buildClassificationPrompt(message, company) }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: MESSAGE_SCHEMA,
    },
  });

  const parsed = JSON.parse(response.text);
  const usage = response.usageMetadata || {};

  // Solo un true explícito escala; cualquier otra cosa se trata como "no".
  return {
    detectedLanguage: DETECTED_LANGUAGE_VALUES.includes(parsed.detected_language) ? parsed.detected_language : null,
    needsHuman: parsed.needs_human === true,
    reason: typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, MAX_REASON_LENGTH) : "",
    usage: {
      step: "message_classify",
      model: "gemini-2.5-flash",
      promptTokens: usage.promptTokenCount ?? null,
      outputTokens: usage.candidatesTokenCount ?? null,
    },
  };
}

module.exports = { classifyAdditionalMessage, buildClassificationPrompt };
