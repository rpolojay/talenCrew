const { onRequest } = require("firebase-functions/v2/https");
const cors = require("cors")({ origin: true });
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { COLLECTIONS, LEAD_STATUS, EVENT_TYPE, HANDOFF_TRIGGER } = require("./constants");
const { GEMINI_API_KEY, RESEND_API_KEY } = require("./secrets");
const { buildDedupeKey } = require("./dedupe");
const { analyzeLead } = require("./analyzeLead");
const { validateAnalysis } = require("./geminiSchemas");
const { scoreLead } = require("./scoring");
const { decideRoute, humanReviewDecision, triggerForReason, statusForRoute, logEvent } = require("./pipeline");
const { generateReply } = require("./generateReply");
const { createHandoff } = require("./handoff");
const { classifyAdditionalMessage } = require("./detectLanguage");
const { sendLeadEmailWithQuota } = require("./quota");

const THROTTLE_WINDOW_MS = 60 * 1000;
const THROTTLE_MAX = 5;

const REPLY_FAILURE_REASON = "The automatic reply could not be generated, so the lead has not received a response yet.";
const REPLY_FAILURE_ACTION = "Reply to this lead personally — the automatic reply could not be generated.";
const HUMAN_REVIEW_ACTION = "Review the conversation and follow up personally.";

// generateReply falló (Gemini caído, timeout, cuota...). El lead no puede
// quedar atascado ni sin que nadie se entere: pasa a HUMAN_REVIEW, queda el
// evento y se abre (o se reutiliza, ver createHandoff) un handoff. Al lead no
// se le envía nada — no hay texto que enviar — y el error solo va a los logs:
// ni la respuesta HTTP ni Firestore guardan su mensaje.
async function escalateReplyFailure(db, { leadRef, leadId, companyId, company, lead, analysis, score, fromStatus, route, humanDecision, extraUpdate = {} }) {
  await leadRef.update({ ...extraUpdate, status: LEAD_STATUS.HUMAN_REVIEW, updatedAt: FieldValue.serverTimestamp() });
  await logEvent(db, {
    leadId, companyId, type: EVENT_TYPE.STATUS_CHANGE,
    fromStatus, toStatus: LEAD_STATUS.HUMAN_REVIEW, actor: "system:reply_failure",
    detail: { note: "reply_generation_failed", route },
  });
  const { handoffId, created } = await createHandoff(db, {
    leadId, companyId, company, lead, analysis, score,
    triggeredBy: humanDecision?.triggeredBy || HANDOFF_TRIGGER.AI_LOW_CONFIDENCE,
    reason: humanDecision?.reason ? `${REPLY_FAILURE_REASON} ${humanDecision.reason}` : REPLY_FAILURE_REASON,
    recommendedNextAction: REPLY_FAILURE_ACTION,
  });
  if (created) {
    await logEvent(db, { leadId, companyId, type: EVENT_TYPE.HANDOFF_CREATED, actor: "system:reply_failure", detail: { handoffId } });
  }
  return handoffId;
}

function isValidPayload(body) {
  if (!body || typeof body !== "object") return false;
  if (!body.companyId || typeof body.companyId !== "string") return false;
  if (!body.message || typeof body.message !== "string" || body.message.length > 4000) return false;
  const contact = body.contact || {};
  if (!contact.email && !contact.phone) return false;
  return true;
}

function toMillis(ts) {
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0;
}

function buildBookingLink(company, leadId, name) {
  const url = new URL(company.bookingLink);
  // Cal.com solo guarda un query param en booking.metadata (y por lo tanto
  // en el payload del webhook BOOKING_CREATED) si usa la sintaxis con
  // corchetes `metadata[key]=value` — un `?leadId=xxx` plano se ignora.
  // Ver leadflowCalBookingWebhook en ./booking.js, que depende de esto
  // para encontrar el lead correspondiente a la cita agendada.
  url.searchParams.set("metadata[leadId]", leadId);
  if (name) url.searchParams.set("name", name);
  return url.toString();
}

// Envía el autoReply por email si el lead dejó uno. Leads que solo dejaron
// teléfono se quedan con sentAt: null (todavía no hay canal SMS/WhatsApp
// para leads de formulario). Una falla de envío no rompe la captura — se
// registra y el lead queda con sentAt: null + sendError para verlo en el
// dashboard. Empresas en trial: sujeto al tope diario de ./quota.js.
async function sendAutoReplyEmail(db, companyId, contact, company, language, text, leadId) {
  if (!contact?.email) return { sentAt: null, emailId: null, error: null };
  return sendLeadEmailWithQuota({
    db, companyId, company, to: contact.email, language, text, logContext: `autoReply lead ${leadId}`,
  });
}

exports.leadflowCaptureLead = onRequest({ secrets: [GEMINI_API_KEY, RESEND_API_KEY] }, (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body;
    if (!isValidPayload(body)) {
      return res.status(400).json({
        error: "Invalid payload: companyId, message and contact.email/phone are required",
      });
    }

    const db = getFirestore();
    const companyId = body.companyId;

    let company;
    try {
      const companySnap = await db.collection(COLLECTIONS.COMPANIES).doc(companyId).get();
      if (!companySnap.exists || companySnap.data().isActive === false) {
        return res.status(404).json({ error: "Unknown or inactive companyId" });
      }
      company = companySnap.data();
    } catch (err) {
      console.error("Error leyendo leadflow_companies:", err);
      return res.status(500).json({ error: "Internal error" });
    }

    const contact = {
      name: body.contact.name || null,
      email: body.contact.email || null,
      phone: body.contact.phone || null,
    };
    const dedupeKey = buildDedupeKey(companyId, contact);

    try {
      let recentForContact = [];
      if (dedupeKey) {
        const snap = await db.collection(COLLECTIONS.LEADS).where("dedupeKey", "==", dedupeKey).get();
        recentForContact = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }

      const now = Date.now();
      const recentCount = recentForContact.filter((l) => now - toMillis(l.capturedAt) < THROTTLE_WINDOW_MS).length;
      if (recentCount >= THROTTLE_MAX) {
        return res.status(429).json({ error: "Too many requests for this contact, try again shortly" });
      }

      recentForContact.sort((a, b) => toMillis(b.capturedAt) - toMillis(a.capturedAt));
      const existingLead = recentForContact.find((l) => l.status !== LEAD_STATUS.CLOSED) || null;

      if (existingLead) {
        return await handleAdditionalMessage(db, existingLead, body, company, res);
      }
      return await handleNewLead(db, { companyId, company, contact, dedupeKey, body }, res);
    } catch (err) {
      console.error("Error en leadflowCaptureLead:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });
});

async function handleNewLead(db, { companyId, company, contact, dedupeKey, body }, res) {
  const leadRef = db.collection(COLLECTIONS.LEADS).doc();
  const leadId = leadRef.id;

  const baseLead = {
    companyId,
    source: body.source || "website_form",
    dedupeKey,
    contact,
    companyName: body.companyName || null,
    serviceRequested: body.serviceRequested || null,
    location: body.location || null,
    message: body.message,
    customFields: body.customFields || {},
    capturedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    status: LEAD_STATUS.NEW,
    analysis: null,
    detectedLanguage: null,
    score: null,
    autoReply: null,
    bookingLinkSent: null,
    appointment: null,
    followUp: { attempts: 0, lastSentAt: null, stopped: false, stopReason: null },
    aiUsage: [],
    closedReason: null,
  };

  await leadRef.set(baseLead);
  await logEvent(db, {
    leadId, companyId, type: EVENT_TYPE.STATUS_CHANGE,
    fromStatus: null, toStatus: LEAD_STATUS.NEW, actor: "system:capture",
  });
  await leadRef.update({ status: LEAD_STATUS.ANALYZING, updatedAt: FieldValue.serverTimestamp() });

  // Para el análisis usamos los valores tal cual se recibieron (baseLead
  // trae FieldValue.serverTimestamp(), que no sirve como dato de entrada).
  const leadForAI = { contact, serviceRequested: baseLead.serviceRequested, location: baseLead.location, message: baseLead.message };

  let analysisResult;
  try {
    const result = await analyzeLead(leadForAI, company);
    validateAnalysis(result.analysis);
    analysisResult = result;
  } catch (err) {
    console.error(`Fallo el analisis de IA para lead ${leadId}:`, err);
    await leadRef.update({ status: LEAD_STATUS.HUMAN_REVIEW, updatedAt: FieldValue.serverTimestamp() });
    await logEvent(db, {
      leadId, companyId, type: EVENT_TYPE.STATUS_CHANGE,
      fromStatus: LEAD_STATUS.ANALYZING, toStatus: LEAD_STATUS.HUMAN_REVIEW, actor: "system:analysis_failure",
    });
    const { handoffId } = await createHandoff(db, {
      leadId, companyId, company, lead: baseLead, analysis: null, score: null,
      triggeredBy: HANDOFF_TRIGGER.AI_LOW_CONFIDENCE,
      reason: `AI analysis failed or returned invalid output: ${err.message}`,
      recommendedNextAction: "Review this lead manually — the automated analysis could not be completed.",
    });
    return res.status(201).json({
      leadId, status: LEAD_STATUS.HUMAN_REVIEW, merged: false, handoffId, analysis: null, autoReply: null,
    });
  }

  await leadRef.update({
    analysis: analysisResult.analysis,
    detectedLanguage: analysisResult.analysis.detected_language,
    aiUsage: FieldValue.arrayUnion(analysisResult.usage),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await logEvent(db, {
    leadId, companyId, type: EVENT_TYPE.AI_ANALYSIS, actor: "system:analysis", detail: analysisResult.analysis,
  });

  const score = scoreLead(leadForAI, analysisResult.analysis, company);
  const humanDecision = humanReviewDecision(analysisResult.analysis, company);
  const route = decideRoute({ analysis: analysisResult.analysis, score, company });
  const nextStatus = statusForRoute(route);

  await leadRef.update({ score, updatedAt: FieldValue.serverTimestamp() });

  let replyResult;
  try {
    replyResult = await generateReply(leadForAI, route, company, analysisResult.analysis.detected_language);
  } catch (err) {
    console.error(`Fallo generateReply para lead ${leadId}:`, err);
    const handoffId = await escalateReplyFailure(db, {
      leadRef, leadId, companyId, company, lead: baseLead, analysis: analysisResult.analysis, score,
      fromStatus: LEAD_STATUS.ANALYZING, route, humanDecision,
    });
    return res.status(201).json({
      leadId, status: LEAD_STATUS.HUMAN_REVIEW, merged: false, handoffId, analysis: analysisResult.analysis, autoReply: null,
    });
  }
  let replyText = replyResult.text;
  let bookingLinkSent = null;
  if (route === "QUALIFIED") {
    bookingLinkSent = buildBookingLink(company, leadId, contact.name);
    replyText = `${replyText}\n\n${bookingLinkSent}`;
  }

  const emailResult = await sendAutoReplyEmail(db, companyId, contact, company, replyResult.language, replyText, leadId);

  await leadRef.update({
    autoReply: {
      text: replyText, language: replyResult.language, generatedAt: FieldValue.serverTimestamp(),
      sentAt: emailResult.sentAt, emailId: emailResult.emailId, sendError: emailResult.error,
    },
    bookingLinkSent,
    status: nextStatus,
    aiUsage: FieldValue.arrayUnion(replyResult.usage),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await logEvent(db, { leadId, companyId, type: EVENT_TYPE.AI_REPLY_GENERATED, actor: "system:reply", detail: { route } });
  await logEvent(db, {
    leadId, companyId, type: EVENT_TYPE.STATUS_CHANGE,
    fromStatus: LEAD_STATUS.ANALYZING, toStatus: nextStatus, actor: "system:pipeline",
  });

  let handoffId = null;
  if (route === "NEEDS_HUMAN") {
    const result = await createHandoff(db, {
      leadId, companyId, company, lead: baseLead, analysis: analysisResult.analysis, score,
      triggeredBy: humanDecision.triggeredBy,
      reason: humanDecision.reason,
      recommendedNextAction: HUMAN_REVIEW_ACTION,
    });
    handoffId = result.handoffId;
    if (result.created) {
      await logEvent(db, { leadId, companyId, type: EVENT_TYPE.HANDOFF_CREATED, actor: "system:pipeline", detail: { handoffId } });
    }
  }

  return res.status(201).json({
    leadId, status: nextStatus, merged: false, handoffId,
    analysis: analysisResult.analysis,
    autoReply: { text: replyText, language: replyResult.language },
  });
}

async function handleAdditionalMessage(db, existingLead, body, company, res) {
  const leadId = existingLead.id;
  const companyId = existingLead.companyId;
  const leadRef = db.collection(COLLECTIONS.LEADS).doc(leadId);

  if (!existingLead.followUp?.stopped) {
    await leadRef.update({
      "followUp.stopped": true,
      "followUp.stopReason": "lead_replied",
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logEvent(db, {
      leadId, companyId, type: EVENT_TYPE.STATUS_CHANGE, actor: "system:capture",
      detail: { note: "follow-up stopped, lead replied" },
    });
  }

  const leadForAI = { contact: existingLead.contact, serviceRequested: existingLead.serviceRequested, location: existingLead.location, message: body.message };
  // El handoff de un mensaje adicional muestra ESTE mensaje, no el primero.
  const leadForHandoff = { contact: existingLead.contact, message: body.message };
  const analysis = existingLead.analysis;
  const score = existingLead.score;
  const fromStatus = existingLead.status;

  // El idioma se re-detecta en CADA mensaje nuevo, no se arrastra el del
  // primer mensaje — un lead puede empezar en inglés y seguir en español
  // (o al revés). Si la detección falla, cae de vuelta al idioma ya
  // guardado en el lead (y de ahí, generateReply cae a company.language).
  // La misma llamada dice si ESTE mensaje necesita una persona (el análisis
  // completo del primer mensaje no se vuelve a correr). Si falla, se sigue
  // solo con el análisis guardado, como antes.
  const previousDetectedLanguage = existingLead.detectedLanguage ?? existingLead.analysis?.detected_language ?? null;
  let detectedLanguage = previousDetectedLanguage;
  let langUsage = null;
  let messageDecision = null;
  try {
    const classification = await classifyAdditionalMessage(body.message, company);
    langUsage = classification.usage;
    if (classification.detectedLanguage) detectedLanguage = classification.detectedLanguage;
    if (classification.needsHuman) {
      messageDecision = { triggeredBy: triggerForReason(classification.reason), reason: classification.reason };
    }
  } catch (err) {
    console.error(`No se pudo clasificar el mensaje adicional para lead ${leadId}:`, err);
  }

  const humanDecision = messageDecision || (analysis ? humanReviewDecision(analysis, company) : null);
  const route = humanDecision ? "NEEDS_HUMAN"
    : analysis ? decideRoute({ analysis, score, company })
    : "NEEDS_INFO";

  let replyResult;
  try {
    replyResult = await generateReply(leadForAI, route, company, detectedLanguage);
  } catch (err) {
    console.error(`Fallo generateReply (mensaje adicional) para lead ${leadId}:`, err);
    const handoffId = await escalateReplyFailure(db, {
      leadRef, leadId, companyId, company, lead: leadForHandoff, analysis, score, fromStatus, route, humanDecision,
      extraUpdate: { detectedLanguage, ...(langUsage ? { aiUsage: FieldValue.arrayUnion(langUsage) } : {}) },
    });
    return res.status(201).json({
      leadId, status: LEAD_STATUS.HUMAN_REVIEW, merged: true, handoffId, analysis, autoReply: null,
    });
  }
  let replyText = replyResult.text;
  let bookingLinkSent = existingLead.bookingLinkSent;
  if (route === "QUALIFIED") {
    if (!bookingLinkSent) bookingLinkSent = buildBookingLink(company, leadId, existingLead.contact.name);
    replyText = `${replyText}\n\n${bookingLinkSent}`;
  }

  const nextStatus =
    route === "NEEDS_HUMAN" ? LEAD_STATUS.HUMAN_REVIEW
    : existingLead.status === LEAD_STATUS.APPOINTMENT_BOOKED ? existingLead.status
    : statusForRoute(route);

  const emailResult = await sendAutoReplyEmail(db, companyId, existingLead.contact, company, replyResult.language, replyText, leadId);

  await leadRef.update({
    autoReply: {
      text: replyText, language: replyResult.language, generatedAt: FieldValue.serverTimestamp(),
      sentAt: emailResult.sentAt, emailId: emailResult.emailId, sendError: emailResult.error,
    },
    detectedLanguage,
    bookingLinkSent,
    status: nextStatus,
    aiUsage: langUsage ? FieldValue.arrayUnion(replyResult.usage, langUsage) : FieldValue.arrayUnion(replyResult.usage),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await logEvent(db, { leadId, companyId, type: EVENT_TYPE.AI_REPLY_GENERATED, actor: "system:reply", detail: { route, merged: true } });
  if (nextStatus !== fromStatus) {
    await logEvent(db, {
      leadId, companyId, type: EVENT_TYPE.STATUS_CHANGE,
      fromStatus, toStatus: nextStatus, actor: "system:pipeline", detail: { merged: true },
    });
  }
  if (detectedLanguage !== previousDetectedLanguage) {
    await logEvent(db, {
      leadId, companyId, type: EVENT_TYPE.AI_ANALYSIS, actor: "system:language_detect",
      detail: { note: "detected_language changed", from: previousDetectedLanguage, to: detectedLanguage },
    });
  }

  let handoffId = null;
  if (route === "NEEDS_HUMAN") {
    const result = await createHandoff(db, {
      leadId, companyId, company, lead: leadForHandoff, analysis, score,
      triggeredBy: humanDecision.triggeredBy,
      reason: humanDecision.reason,
      recommendedNextAction: HUMAN_REVIEW_ACTION,
    });
    handoffId = result.handoffId;
    if (result.created) {
      await logEvent(db, { leadId, companyId, type: EVENT_TYPE.HANDOFF_CREATED, actor: "system:pipeline", detail: { handoffId, merged: true } });
    }
  }

  return res.status(201).json({
    leadId, status: nextStatus, merged: true, handoffId,
    analysis, autoReply: { text: replyText, language: replyResult.language },
  });
}
