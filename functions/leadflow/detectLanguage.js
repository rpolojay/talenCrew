const { GoogleGenAI, Type } = require("@google/genai");
const { GEMINI_API_KEY } = require("./secrets");
const { DETECTED_LANGUAGE_VALUES } = require("./geminiSchemas");

// Llamada de IA separada de analyzeLead() — se usa en handleAdditionalMessage
// (capture.js), donde el analisis completo (intent/qualification/score) NO
// se vuelve a correr y se conserva del primer mensaje, pero el IDIOMA si
// puede cambiar de un mensaje a otro (ej. el lead empezo en ingles y ahora
// escribe en espanol) y generateReply necesita el idioma real de ESTE
// mensaje, no el detectado en el primero.
const LANGUAGE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    detected_language: { type: Type.STRING, enum: DETECTED_LANGUAGE_VALUES },
  },
  required: ["detected_language"],
};

async function detectMessageLanguage(message) {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{
      role: "user",
      parts: [{
        text: `What language is the following message written in?\n\nMessage: "${message}"`,
      }],
    }],
    config: {
      responseMimeType: "application/json",
      responseSchema: LANGUAGE_SCHEMA,
    },
  });

  const parsed = JSON.parse(response.text);
  const usage = response.usageMetadata || {};

  return {
    detectedLanguage: DETECTED_LANGUAGE_VALUES.includes(parsed.detected_language) ? parsed.detected_language : null,
    usage: {
      step: "language_detect",
      model: "gemini-2.5-flash",
      promptTokens: usage.promptTokenCount ?? null,
      outputTokens: usage.candidatesTokenCount ?? null,
    },
  };
}

module.exports = { detectMessageLanguage };
