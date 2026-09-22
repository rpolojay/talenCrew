const { onRequest } = require("firebase-functions/v2/https");
const cors = require("cors")({ origin: true });
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { COLLECTIONS, LEAD_STATUS, EVENT_TYPE, HANDOFF_TRIGGER } = require("./constants");
const { GEMINI_API_KEY } = require("./secrets");
const { buildDedupeKey } = require("./dedupe");
const { analyzeLead } = require("./analyzeLead");
const { validateAnalysis } = require("./geminiSchemas");
const { scoreLead } = require("./scoring");
const { decideRoute, statusForRoute, logEvent } = require("./pipeline");
const { generateReply } = require("./generateReply");
const { createHandoff } = require("./handoff");

const THROTTLE_WINDOW_MS = 60 * 1000;
const THROTTLE_MAX = 5;

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

exports.leadflowCaptureLead = onRequest({ secrets: [GEMINI_API_KEY] }, (req, res) => {
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
    const handoffId = await createHandoff(db, {
      leadId, companyId, lead: baseLead, analysis: null, score: null,
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
  const route = decideRoute({ analysis: analysisResult.analysis, score, company });
  const nextStatus = statusForRoute(route);

  await leadRef.update({ score, updatedAt: FieldValue.serverTimestamp() });

  const replyResult = await generateReply(leadForAI, route, company, analysisResult.analysis.detected_language);
  let replyText = replyResult.text;
  let bookingLinkSent = null;
  if (route === "QUALIFIED") {
    bookingLinkSent = buildBookingLink(company, leadId, contact.name);
    replyText = `${replyText}\n\n${bookingLinkSent}`;
  }

  await leadRef.update({
    autoReply: { text: replyText, language: replyResult.language, generatedAt: FieldValue.serverTimestamp(), sentAt: null },
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
    const reasonLower = (analysisResult.analysis.reason || "").toLowerCase();
    handoffId = await createHandoff(db, {
      leadId, companyId, lead: baseLead, analysis: analysisResult.analysis, score,
      triggeredBy: reasonLower.includes("price") || reasonLower.includes("negotiat")
        ? HANDOFF_TRIGGER.PRICE_NEGOTIATION
        : HANDOFF_TRIGGER.AI_LOW_CONFIDENCE,
      reason: analysisResult.analysis.reason,
      recommendedNextAction: "Review the conversation and follow up personally.",
    });
    await logEvent(db, { leadId, companyId, type: EVENT_TYPE.HANDOFF_CREATED, actor: "system:pipeline", detail: { handoffId } });
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
  const analysis = existingLead.analysis;
  const score = existingLead.score;
  const route = analysis ? decideRoute({ analysis, score, company }) : "NEEDS_INFO";

  const replyResult = await generateReply(leadForAI, route, company, existingLead.detectedLanguage ?? existingLead.analysis?.detected_language);
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

  await leadRef.update({
    autoReply: { text: replyText, language: replyResult.language, generatedAt: FieldValue.serverTimestamp(), sentAt: null },
    bookingLinkSent,
    status: nextStatus,
    aiUsage: FieldValue.arrayUnion(replyResult.usage),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await logEvent(db, { leadId, companyId, type: EVENT_TYPE.AI_REPLY_GENERATED, actor: "system:reply", detail: { route, merged: true } });

  return res.status(201).json({
    leadId, status: nextStatus, merged: true, handoffId: null,
    analysis, autoReply: { text: replyText, language: replyResult.language },
  });
}
