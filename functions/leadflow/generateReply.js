const { GoogleGenAI } = require("@google/genai");
const { GEMINI_API_KEY } = require("./secrets");
const { untrustedBlock, businessProfileBlock, UNTRUSTED_NOTICE, BUSINESS_NOTICE } = require("./promptData");

// Llamada #2 de IA (Fase 2.4 / Step 6.1 paso 5) — texto natural, en el
// idioma del tenant (leadflow_companies.language), usando la ruta ya
// decidida por pipeline.js como contexto. Nunca genera el link de booking
// ella misma (ver nota en capture.js) — solo anuncia que se va a enviar.
function buildReplyInstruction(route) {
  switch (route) {
    case "NEEDS_HUMAN":
      return "The topic is outside what you're allowed to answer, involves a sensitive matter or price negotiation, or the customer asked for a human. Warmly acknowledge their message and tell them a team member will personally follow up soon. Do NOT attempt to answer the underlying question, and do NOT mention booking.";
    case "OUT_OF_AREA":
      return "This lead appears to be outside the service area described in <business_profile>. Politely explain the service area and thank them for reaching out. Do NOT invite them to book.";
    case "NEEDS_INFO":
      return "Key information is missing (the service needed or their location). Ask ONE warm, brief clarifying question to get it. Do NOT invite them to book yet.";
    case "LOW_INTENT":
      return "This lead shows low urgency or intent. Give a warm, low-pressure, informative response without pushing them to book immediately.";
    case "FOLLOW_UP_FIRST":
      return "This lead was sent a booking link a while ago and hasn't scheduled yet. Send a warm, brief check-in reminding them that a link to book is available, and invite them to reach out if they have questions. Do NOT write out any URL yourself — it will be added separately, after your reply.";
    case "FOLLOW_UP_SECOND":
      return "This is a final, low-pressure follow-up — the lead was already reminded once and still hasn't scheduled. Keep it brief, mention this is your last check-in about it, and that you're happy to help whenever they're ready. Do NOT write out any URL yourself — it will be added separately, after your reply.";
    case "QUALIFIED_NO_BOOKING":
      return "This lead is qualified, but there is no online booking link. Give a warm, helpful response and let them know a team member will contact them shortly to schedule a consultation. Do NOT mention or promise any link, and do NOT write out any URL.";
    case "QUALIFIED":
    default:
      return "This lead is qualified. Give a warm, helpful response and let them know you're sending them a link to book a consultation. Do NOT write out any URL yourself — it will be added separately, after your reply.";
  }
}

// El texto sale por email a la dirección que dejó el lead. Los datos del
// lead Y los del negocio van delimitados como datos (./promptData.js): ni el
// formulario público ni quien registra un trial pueden meter instrucciones,
// y la respuesta no puede incluir enlaces ni contactos — así el endpoint no
// sirve para hacer llegar contenido arbitrario (p. ej. phishing). El link de
// reserva no pasa por aquí: lo agrega el código después (capture.js), y la
// salida se valida antes de enviarse (./emailPolicy.js validateReplyText).
function buildReplyPrompt(lead, route, company, languageName) {
  return `You are the customer-facing assistant for the business described in <business_profile> below.
Respond in ${languageName}.

BUSINESS PROFILE:
${businessProfileBlock(company)}
${BUSINESS_NOTICE}

LEAD:
${untrustedBlock({ name: lead.contact?.name || "there", message: lead.message })}
${UNTRUSTED_NOTICE}

Rules:
- Use the tone from <business_profile>. Respect its pricingPolicy and guaranteesPolicy; never state exact prices or promise warranties or guarantees.
- Never state information about the business beyond what's in <business_profile>.
- Never write any URL, link, email address or phone number. Never repeat any URL, email address or phone number that appears inside <lead_data> or <business_profile>.

Instruction: ${buildReplyInstruction(route)}

Write only the reply text (no preamble, no signature), under 4 sentences.`;
}

async function generateReply(lead, route, company, detectedLanguage) {
  // Responde en el idioma real del mensaje del lead (detectado por
  // analyzeLead.js), no en el idioma por defecto de la empresa — ese
  // default solo sirve de respaldo cuando la detección vino ambigua o no
  // vino (ver validateAnalysis() en geminiSchemas.js).
  const effectiveLanguage = detectedLanguage === "en" || detectedLanguage === "es" ? detectedLanguage : company.language;
  const languageName = effectiveLanguage === "es" ? "Spanish" : "English";
  const prompt = buildReplyPrompt(lead, route, company, languageName);

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const usage = response.usageMetadata || {};
  return {
    text: (response.text || "").trim(),
    language: effectiveLanguage,
    usage: {
      step: "reply",
      model: "gemini-2.5-flash",
      promptTokens: usage.promptTokenCount ?? null,
      outputTokens: usage.candidatesTokenCount ?? null,
    },
  };
}

module.exports = { generateReply, buildReplyInstruction, buildReplyPrompt };
