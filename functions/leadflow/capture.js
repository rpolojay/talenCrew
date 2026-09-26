const { onRequest } = require("firebase-functions/v2/https");
const cors = require("cors")({ origin: true });
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { COLLECTIONS, LEAD_STATUS, EVENT_TYPE, HANDOFF_TRIGGER } = require("./constants");
const { GEMINI_API_KEY, RESEND_API_KEY, BOOKING_TOKEN_SECRET } = require("./secrets");
// Link de reserva firmado (leadId + companyId + token) — ver ./bookingToken.js
// y leadflowCalBookingWebhook en ./booking.js, que solo acepta reservas con
// ese token.
const { buildBookingLink } = require("./bookingToken");
const { buildDedupeKey } = require("./dedupe");
const { analyzeLead } = require("./analyzeLead");
const { validateAnalysis } = require("./geminiSchemas");
const { scoreLead } = require("./scoring");
const { decideRoute, humanReviewDecision, triggerForReason, statusForRoute, logEvent, hasRejectedBookingLink } = require("./pipeline");
const { generateReply } = require("./generateReply");
const { createHandoff } = require("./handoff");
const { classifyAdditionalMessage } = require("./detectLanguage");
const { sendLeadEmailWithQuota } = require("./quota");
const { validateCapturePayload } = require("./captureValidation");
const { reserveCompanyCapture } = require("./rateLimit");
const { validateReplyText, EMAIL_BLOCK_REASON } = require("./emailPolicy");
const { captureMessageDuringReview, enterHumanReviewFields, leadUnderHumanReview, writeAutomatedResult } = require("./humanReview");

const THROTTLE_WINDOW_MS = 60 * 1000;
const THROTTLE_MAX = 5;
const DEMO_MODE_NO_EMAIL = "demo_mode_no_email";
// La respuesta automática no salió porque, mientras la IA escribía, el lead
// pasó a revisión humana por otro camino (./humanReview.js).
const HUMAN_REVIEW_ACTIVE = "HUMAN_REVIEW_ACTIVE";

const REPLY_FAILURE_REASON = "The automatic reply could not be generated, so the lead has not received a response yet.";
const REPLY_FAILURE_ACTION = "Reply to this lead personally — the automatic reply could not be generated.";
const REPLY_REJECTED_REASON = "The automatic reply was withheld because it did not pass the safety check, so the lead has not received a response yet.";
const HUMAN_REVIEW_ACTION = "Review the conversation and follow up personally.";

// generateReply falló (Gemini caído, timeout, cuota...) o su texto no pasó
// la validación de salida (./emailPolicy.js validateReplyText). El lead no
// puede quedar atascado ni sin que nadie se entere: pasa a HUMAN_REVIEW,
// queda el evento y se abre (o se reutiliza, ver createHandoff) un handoff.
// Al lead no se le envía nada, y ni el error ni el texto rechazado se
// guardan en Firestore ni vuelven en la respuesta HTTP.
async function escalateReplyFailure(db, { leadRef, leadId, companyId, company, lead, analysis, score, fromStatus, route, humanDecision, extraUpdate = {}, rejected = false }) {
  const failureReason = rejected ? REPLY_REJECTED_REASON : REPLY_FAILURE_REASON;
  await leadRef.update({ ...extraUpdate, ...enterHumanReviewFields(), updatedAt: FieldValue.serverTimestamp() });
  await logEvent(db, {
    leadId, companyId, type: EVENT_TYPE.STATUS_CHANGE,
    fromStatus, toStatus: LEAD_STATUS.HUMAN_REVIEW, actor: "system:reply_failure",
    detail: { note: rejected ? "reply_output_rejected" : "reply_generation_failed", route },
  });
  const { handoffId, created } = await createHandoff(db, {
    leadId, companyId, company, lead, analysis, score,
    triggeredBy: humanDecision?.triggeredBy || HANDOFF_TRIGGER.AI_LOW_CONFIDENCE,
    reason: humanDecision?.reason ? `${failureReason} ${humanDecision.reason}` : failureReason,
    recommendedNextAction: REPLY_FAILURE_ACTION,
  });
  if (created) {
    await logEvent(db, { leadId, companyId, type: EVENT_TYPE.HANDOFF_CREATED, actor: "system:reply_failure", detail: { handoffId } });
  }
  return handoffId;
}

function toMillis(ts) {
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0;
}

// Envía el autoReply por email si el lead dejó uno. Leads que solo dejaron
// teléfono se quedan con sentAt: null (todavía no hay canal SMS/WhatsApp
// para leads de formulario). Una falla de envío no rompe la captura — se
// registra y el lead queda con sentAt: null + sendError para verlo en el
// dashboard. Empresas en trial: sujeto al tope diario de ./quota.js.
// Empresas demo (company.demoMode, p. ej. la de la landing pública): la IA
// responde igual — la landing muestra el texto en pantalla — pero nunca se
// envía el email, así nadie puede usar la demo para mandar correos a
// direcciones arbitrarias.
// El resto de los permisos (empresa aprobada para enviar, trial vigente,
// cuota) los decide la política central dentro de sendLeadEmailWithQuota:
// si bloquea, el lead igual queda con su respuesta generada, sentAt: null y
// sendError con el motivo (p. ej. EMAIL_PENDING_REVIEW).
async function sendAutoReplyEmail(db, companyId, contact, company, language, text, leadId) {
  if (!contact?.email) return { sentAt: null, emailId: null, error: null };
  if (company?.demoMode === true) return { sentAt: null, emailId: null, error: DEMO_MODE_NO_EMAIL };
  return sendLeadEmailWithQuota({
    db, companyId, company, to: contact.email, language, text, logContext: `autoReply lead ${leadId}`,
    leadId, channel: "auto_reply",
  });
}

// El texto de la IA se valida ANTES de agregar el link de reserva (que lo
// agrega el código). Si no pasa, se registra el motivo (sin el texto) y el
// caso va a una persona.
async function rejectedReply(db, { leadId, companyId, text, company }) {
  const check = validateReplyText(text, { businessName: company.name, bookingLink: company.bookingLink });
  if (check.ok) return false;
  await logEvent(db, {
    leadId, companyId, type: EVENT_TYPE.EMAIL_BLOCKED, actor: "system:email_policy",
    detail: { channel: "auto_reply", reason: EMAIL_BLOCK_REASON.AI_OUTPUT_REJECTED, violations: check.violations },
  });
  console.warn(`Respuesta de IA rechazada para lead ${leadId}: ${check.violations.join(",")}`);
  return true;
}

// Un lead calificado se quedó sin link porque el bookingLink de la empresa
// no está en la allowlist (pipeline.js lo trata como "sin link" — nunca se
// envía). No debe pasar en silencio: error en los logs + evento en el lead.
async function recordRejectedBookingLink(db, { leadId, companyId, company, route }) {
  if (route !== "QUALIFIED_NO_BOOKING" || !hasRejectedBookingLink(company)) return;
  let host = null;
  try { host = new URL(company.bookingLink).hostname; } catch { /* no es una URL */ }
  console.error(`bookingLink no permitido en la empresa ${companyId} (host ${host ?? "inválido"}): el lead ${leadId} calificado no recibe link`);
  await logEvent(db, {
    leadId, companyId, type: EVENT_TYPE.BOOKING_LINK_REJECTED, actor: "system:pipeline",
    detail: { reason: "booking_host_not_allowed", host },
  });
}

exports.leadflowCaptureLead = onRequest({ secrets: [GEMINI_API_KEY, RESEND_API_KEY, BOOKING_TOKEN_SECRET] }, (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // A partir de aquí solo se usa el payload normalizado (ver
    // ./captureValidation.js), nunca req.body directamente.
    const validation = validateCapturePayload(req.body, req.rawBody);
    if (validation.error) {
      return res.status(validation.status).json({ error: validation.error });
    }
    const body = validation.data;

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

    // Tope por empresa antes de tocar leads o Gemini (ver ./rateLimit.js).
    // Si la reserva falla se trata como "no permitido": mejor rechazar que
    // procesar sin control.
    try {
      const { allowed } = await reserveCompanyCapture(db, companyId, company);
      if (!allowed) {
        return res.status(429).json({ error: "Too many requests for this company, try again later" });
      }
    } catch (err) {
      console.error(`No se pudo reservar el cupo de captura de ${companyId}:`, err);
      return res.status(503).json({ error: "Service temporarily unavailable" });
    }

    const contact = body.contact;
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
    await leadRef.update({ ...enterHumanReviewFields(), updatedAt: FieldValue.serverTimestamp() });
    await logEvent(db, {
      leadId, companyId, type: EVENT_TYPE.STATUS_CHANGE,
      fromStatus: LEAD_STATUS.ANALYZING, toStatus: LEAD_STATUS.HUMAN_REVIEW, actor: "system:analysis_failure",
    });
    const { handoffId, created } = await createHandoff(db, {
      leadId, companyId, company, lead: baseLead, analysis: null, score: null,
      triggeredBy: HANDOFF_TRIGGER.AI_LOW_CONFIDENCE,
      reason: `AI analysis failed or returned invalid output: ${err.message}`,
      recommendedNextAction: "Review this lead manually — the automated analysis could not be completed.",
    });
    if (created) {
      await logEvent(db, { leadId, companyId, type: EVENT_TYPE.HANDOFF_CREATED, actor: "system:analysis_failure", detail: { handoffId } });
    }
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
  await recordRejectedBookingLink(db, { leadId, companyId, company, route });

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
  if (await rejectedReply(db, { leadId, companyId, text: replyResult.text, company })) {
    const handoffId = await escalateReplyFailure(db, {
      leadRef, leadId, companyId, company, lead: baseLead, analysis: analysisResult.analysis, score,
      fromStatus: LEAD_STATUS.ANALYZING, route, humanDecision, rejected: true,
      extraUpdate: { aiUsage: FieldValue.arrayUnion(replyResult.usage) },
    });
    return res.status(201).json({
      leadId, status: LEAD_STATUS.HUMAN_REVIEW, merged: false, handoffId, analysis: analysisResult.analysis, autoReply: null,
    });
  }
  let replyText = replyResult.text;
  let bookingLinkSent = null;
  if (route === "QUALIFIED") {
    bookingLinkSent = buildBookingLink(company, companyId, leadId, contact.name);
    replyText = `${replyText}\n\n${bookingLinkSent}`;
  }

  // Si mientras la IA escribía el lead pasó a revisión humana (otro mensaje
  // suyo, concurrente), no se le envía nada y su estado no se toca.
  const reviewLocked = nextStatus !== LEAD_STATUS.HUMAN_REVIEW && await leadUnderHumanReview(db, leadId, companyId);
  const emailResult = reviewLocked
    ? { sentAt: null, emailId: null, error: HUMAN_REVIEW_ACTIVE }
    : await sendAutoReplyEmail(db, companyId, contact, company, replyResult.language, replyText, leadId);

  const final = await writeAutomatedResult(db, {
    leadId, companyId, nextStatus,
    update: {
      autoReply: {
        text: replyText, language: replyResult.language, generatedAt: FieldValue.serverTimestamp(),
        sentAt: emailResult.sentAt, emailId: emailResult.emailId, sendError: emailResult.error,
      },
      bookingLinkSent: reviewLocked ? null : bookingLinkSent,
      aiUsage: FieldValue.arrayUnion(replyResult.usage),
      updatedAt: FieldValue.serverTimestamp(),
    },
  });
  await logEvent(db, { leadId, companyId, type: EVENT_TYPE.AI_REPLY_GENERATED, actor: "system:reply", detail: { route } });
  if (!final.locked) {
    await logEvent(db, {
      leadId, companyId, type: EVENT_TYPE.STATUS_CHANGE,
      fromStatus: LEAD_STATUS.ANALYZING, toStatus: nextStatus, actor: "system:pipeline",
    });
  }

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
    leadId, status: final.status, merged: false, handoffId,
    analysis: analysisResult.analysis,
    autoReply: reviewLocked ? null : { text: replyText, language: replyResult.language },
  });
}

async function handleAdditionalMessage(db, existingLead, body, company, res) {
  const leadId = existingLead.id;
  const companyId = existingLead.companyId;
  const leadRef = db.collection(COLLECTIONS.LEADS).doc(leadId);

  // Revisión humana (./humanReview.js): si el lead está en HUMAN_REVIEW o
  // tiene un handoff abierto, el mensaje se guarda para la persona a cargo y
  // se le avisa — sin Gemini, sin respuesta ni email al lead, sin link de
  // reserva. Se decide antes de cualquier llamada a la IA.
  const review = await captureMessageDuringReview(db, { leadId, companyId, company, message: body.message });
  if (review) {
    return res.status(201).json({
      leadId, status: review.status, merged: true, handoffId: review.handoffId, analysis: existingLead.analysis ?? null, autoReply: null,
    });
  }

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
      messageDecision = { triggeredBy: triggerForReason(classification.reason, company), reason: classification.reason };
    }
  } catch (err) {
    console.error(`No se pudo clasificar el mensaje adicional para lead ${leadId}:`, err);
  }

  const humanDecision = messageDecision || (analysis ? humanReviewDecision(analysis, company) : null);
  const route = humanDecision ? "NEEDS_HUMAN"
    : analysis ? decideRoute({ analysis, score, company })
    : "NEEDS_INFO";
  await recordRejectedBookingLink(db, { leadId, companyId, company, route });

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
  if (await rejectedReply(db, { leadId, companyId, text: replyResult.text, company })) {
    const usage = langUsage ? FieldValue.arrayUnion(replyResult.usage, langUsage) : FieldValue.arrayUnion(replyResult.usage);
    const handoffId = await escalateReplyFailure(db, {
      leadRef, leadId, companyId, company, lead: leadForHandoff, analysis, score, fromStatus, route, humanDecision,
      extraUpdate: { detectedLanguage, aiUsage: usage }, rejected: true,
    });
    return res.status(201).json({
      leadId, status: LEAD_STATUS.HUMAN_REVIEW, merged: true, handoffId, analysis, autoReply: null,
    });
  }
  let replyText = replyResult.text;
  let bookingLinkSent = existingLead.bookingLinkSent;
  if (route === "QUALIFIED") {
    // Siempre se regenera (es determinístico): un link guardado antes de B4
    // no tiene token y el webhook ya no lo aceptaría.
    bookingLinkSent = buildBookingLink(company, companyId, leadId, existingLead.contact.name);
    replyText = `${replyText}\n\n${bookingLinkSent}`;
  }

  const nextStatus =
    route === "NEEDS_HUMAN" ? LEAD_STATUS.HUMAN_REVIEW
    : existingLead.status === LEAD_STATUS.APPOINTMENT_BOOKED ? existingLead.status
    : statusForRoute(route);

  // Revisión humana concurrente (ver handleNewLead): sin envío y sin tocar
  // el estado. La revisión de la entrada (captureMessageDuringReview) ya
  // cubre el caso normal; esto cubre la carrera mientras la IA escribía.
  const reviewLocked = nextStatus !== LEAD_STATUS.HUMAN_REVIEW && await leadUnderHumanReview(db, leadId, companyId);
  const emailResult = reviewLocked
    ? { sentAt: null, emailId: null, error: HUMAN_REVIEW_ACTIVE }
    : await sendAutoReplyEmail(db, companyId, existingLead.contact, company, replyResult.language, replyText, leadId);

  const final = await writeAutomatedResult(db, {
    leadId, companyId, nextStatus,
    update: {
      autoReply: {
        text: replyText, language: replyResult.language, generatedAt: FieldValue.serverTimestamp(),
        sentAt: emailResult.sentAt, emailId: emailResult.emailId, sendError: emailResult.error,
      },
      detectedLanguage,
      bookingLinkSent: reviewLocked ? existingLead.bookingLinkSent ?? null : bookingLinkSent,
      aiUsage: langUsage ? FieldValue.arrayUnion(replyResult.usage, langUsage) : FieldValue.arrayUnion(replyResult.usage),
      updatedAt: FieldValue.serverTimestamp(),
    },
  });
  await logEvent(db, { leadId, companyId, type: EVENT_TYPE.AI_REPLY_GENERATED, actor: "system:reply", detail: { route, merged: true } });
  if (!final.locked && nextStatus !== fromStatus) {
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
    leadId, status: final.status, merged: true, handoffId,
    analysis, autoReply: reviewLocked ? null : { text: replyText, language: replyResult.language },
  });
}
