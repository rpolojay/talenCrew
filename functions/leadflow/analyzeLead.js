const { GoogleGenAI } = require("@google/genai");
const { GEMINI_API_KEY } = require("./secrets");
const { LEAD_ANALYSIS_SCHEMA } = require("./geminiSchemas");

// Llamada #1 de IA (Fase 2.2 / Step 6.1 paso 2). Salida SOLO estructurada
// (responseSchema) — nada de texto libre, porque esta salida alimenta
// decisiones automáticas (scoring, ruta del pipeline).
function buildAnalysisPrompt(lead, company) {
  return `You are a lead qualification engine for "${company.name}", a ${company.industry} business.

BUSINESS FACTS (the only facts you may treat as true about this business):
- Services offered: ${company.servicesOffered.join(", ")}
- Service area: ${company.serviceArea.city}, ${company.serviceArea.state}, within ${company.serviceArea.radiusMiles} miles
- Hours: ${company.businessFacts.hours}

LEAD:
- Name: ${lead.contact.name || "unknown"}
- Service requested: ${lead.serviceRequested || "unspecified"}
- Location: ${lead.location || "unspecified"}
- Message: "${lead.message}"

Analyze this lead and return structured JSON only, following these rules:
- "qualification" = "unqualified" if the location is clearly outside the service area, or overall intent is clearly low.
- "qualification" = "needs_more_info" if the service or location is missing or too vague to judge.
- "needs_human" = true if the message involves a sensitive topic (legal, injury, insurance dispute), a price negotiation, or an explicit request to talk to a person.
- lead_score is 0-100, reflecting the overall quality/value of this lead for the business.
- confidence is 0-1, your confidence in this analysis.
- "detected_language" = the language the LEAD'S MESSAGE above is written in — "es" for Spanish, "en" for English. Base this only on the lead's message text itself, never on the business's own default language.
- Never invent facts about the business beyond what's listed above.`;
}

async function analyzeLead(lead, company) {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: buildAnalysisPrompt(lead, company) }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: LEAD_ANALYSIS_SCHEMA,
    },
  });

  const parsed = JSON.parse(response.text);
  const usage = response.usageMetadata || {};

  return {
    analysis: parsed,
    usage: {
      step: "analysis",
      model: "gemini-2.5-flash",
      promptTokens: usage.promptTokenCount ?? null,
      outputTokens: usage.candidatesTokenCount ?? null,
    },
  };
}

module.exports = { analyzeLead, buildAnalysisPrompt };
