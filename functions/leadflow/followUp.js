const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { COLLECTIONS, LEAD_STATUS, EVENT_TYPE } = require("./constants");
const { GEMINI_API_KEY, RESEND_API_KEY, BOOKING_TOKEN_SECRET } = require("./secrets");
const { generateReply } = require("./generateReply");
const { buildBookingLink, isAllowedBookingUrl } = require("./bookingToken");
const { logEvent } = require("./pipeline");
const { sendLeadEmailWithQuota } = require("./quota");
const { evaluateLeadEmailPolicy, validateReplyText, POLICY_BLOCK_REASONS, EMAIL_BLOCK_REASON } = require("./emailPolicy");

const MS_PER_HOUR = 60 * 60 * 1000;

// Si falta el timestamp de referencia (no debería pasar para un lead en
// BOOKING_SENT, pero es un dato externo/legado posible) devuelve -1 en vez
// de 0 — como el umbral configurado siempre es positivo, -1 nunca alcanza a
// "vencer", así que un dato corrupto nunca dispara un follow-up de más.
function hoursSince(timestamp) {
  if (!timestamp || typeof timestamp.toMillis !== "function") return -1;
  return (Date.now() - timestamp.toMillis()) / MS_PER_HOUR;
}

// followUpConfig hoy solo define dos etapas (delayHoursFirst/Second, Fase
// 2.7) — intento 0 → primer recordatorio, intento 1 → segundo y último.
// Cualquier intento >= 2 no tiene una etapa definida, así que se trata como
// "agotado" sin importar qué diga maxAttempts.
function evaluateFollowUp(lead, followUpConfig) {
  const attempts = lead.followUp?.attempts ?? 0;

  if (attempts === 0) {
    return {
      stage: "first",
      route: "FOLLOW_UP_FIRST",
      thresholdHours: followUpConfig.delayHoursFirst,
      reference: lead.autoReply?.generatedAt,
      hoursElapsed: hoursSince(lead.autoReply?.generatedAt),
    };
  }
  if (attempts === 1) {
    return {
      stage: "second",
      route: "FOLLOW_UP_SECOND",
      thresholdHours: followUpConfig.delayHoursSecond,
      reference: lead.followUp?.lastSentAt,
      hoursElapsed: hoursSince(lead.followUp?.lastSentAt),
    };
  }
  return null;
}

// Sin catch-up después de una aprobación: si la empresa pasó a ENABLED
// (outboundEmail.enabledAt, ver ./emailPolicy.js setOutboundEmailStatus)
// después del email de referencia de esta etapa, el recordatorio quedó
// "atrasado" mientras no se podía enviar y no sale. El lead no se detiene:
// un mensaje nuevo suyo recibe respuesta y abre un ciclo nuevo.
function predatesEmailApproval(reference, company) {
  const enabledAt = company.outboundEmail?.enabledAt;
  if (!enabledAt || typeof enabledAt.toMillis !== "function") return false;
  if (!reference || typeof reference.toMillis !== "function") return true;
  return reference.toMillis() < enabledAt.toMillis();
}

async function stopFollowUp(db, lead, reason) {
  if (lead.followUp?.stopped) return;
  await db.collection(COLLECTIONS.LEADS).doc(lead.id).update({
    "followUp.stopped": true,
    "followUp.stopReason": reason,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// Step 3 del diseño original. Corre cada 30 min (dentro del rango 30-60 min
// pedido) y revisa todos los leads en BOOKING_SENT de todas las empresas —
// una vez un lead avanza a APPOINTMENT_BOOKED, CLOSED, etc., deja de
// aparecer en este query y el scheduler lo ignora automáticamente sin
// ninguna lógica extra para eso.
exports.leadflowFollowUpScheduler = onSchedule(
  { schedule: "every 30 minutes", secrets: [GEMINI_API_KEY, RESEND_API_KEY, BOOKING_TOKEN_SECRET] },
  async () => {
    const db = getFirestore();

    const snap = await db.collection(COLLECTIONS.LEADS)
      .where("status", "==", LEAD_STATUS.BOOKING_SENT)
      .get();
    if (snap.empty) return;

    const companyCache = new Map();

    for (const doc of snap.docs) {
      const lead = { id: doc.id, ...doc.data() };

      // El lead respondió (capture.js ya marca followUp.stopped en ese
      // caso) o un run anterior de este scheduler ya lo agotó.
      if (lead.followUp?.stopped) continue;

      let company = companyCache.get(lead.companyId);
      if (company === undefined) {
        const companySnap = await db.collection(COLLECTIONS.COMPANIES).doc(lead.companyId).get();
        company = companySnap.exists ? companySnap.data() : null;
        companyCache.set(lead.companyId, company);
      }

      // Sin empresa, sin followUpConfig, o con follow-up desactivado: no
      // queda pendiente para siempre reintentándose cada 30 min — se marca
      // de una vez con un motivo claro para no volver a evaluarlo.
      if (!company) {
        await stopFollowUp(db, lead, "company_not_found");
        continue;
      }
      // Empresa desactivada (ej. trial vencido, ver ./expireTrials.js):
      // capture.js ya no le acepta leads, y tampoco se le mandan
      // recordatorios a los que ya tenía.
      if (company.isActive === false) {
        await stopFollowUp(db, lead, "company_inactive");
        continue;
      }
      // Empresa demo (landing pública): nunca se envían emails a sus leads
      // (ver capture.js), así que tampoco recordatorios — se detiene antes
      // de gastar una llamada de IA.
      if (company.demoMode === true) {
        await stopFollowUp(db, lead, "demo_company");
        continue;
      }
      if (!company.followUpConfig) {
        await stopFollowUp(db, lead, "no_follow_up_config");
        continue;
      }
      if (company.followUpConfig.enabled === false) {
        await stopFollowUp(db, lead, "follow_up_disabled_for_company");
        continue;
      }
      // Permiso de envío de la empresa (./emailPolicy.js): PENDING_REVIEW,
      // SUSPENDED o trial vencido por fecha → no se envía ahora, sin gastar
      // IA. El lead NO se detiene: el permiso puede volver.
      if (!evaluateLeadEmailPolicy(company).allowed) continue;
      // La respuesta inicial nunca le llegó al lead por la política: no se
      // le recuerda algo que no recibió.
      if (POLICY_BLOCK_REASONS.includes(lead.autoReply?.sendError)) continue;
      // Link fuera de la allowlist de proveedores: el recordatorio es sobre
      // ese link, así que no sale (el lead no se detiene).
      if (company.bookingLink && !isAllowedBookingUrl(company.bookingLink)) {
        console.error(`Follow-up omitido: bookingLink no permitido en la empresa ${lead.companyId}`);
        continue;
      }

      const followUpConfig = company.followUpConfig;
      const maxAttempts = followUpConfig.maxAttempts ?? 2;
      const attempts = lead.followUp?.attempts ?? 0;

      if (attempts >= maxAttempts) {
        await stopFollowUp(db, lead, "max_attempts_reached");
        continue;
      }

      const evalResult = evaluateFollowUp(lead, followUpConfig);
      if (!evalResult || typeof evalResult.thresholdHours !== "number") {
        // Sin etapa definida para este intento, o al tenant le falta
        // configurar delayHoursFirst/Second — no hay nada que evaluar.
        await stopFollowUp(db, lead, "max_attempts_reached");
        continue;
      }
      if (evalResult.hoursElapsed < evalResult.thresholdHours) continue; // todavía no toca
      if (predatesEmailApproval(evalResult.reference, company)) continue;

      try {
        const leadForAI = {
          contact: lead.contact,
          serviceRequested: lead.serviceRequested,
          location: lead.location,
          message: lead.message,
        };
        // Mismo criterio que capture.js: el idioma real del lead (el último
        // detectado), no el default de la empresa. Si no hay ninguno
        // guardado, generateReply cae a company.language.
        const detectedLanguage = lead.detectedLanguage ?? lead.analysis?.detected_language ?? null;
        const replyResult = await generateReply(leadForAI, evalResult.route, company, detectedLanguage);

        // Mismo control de salida que capture.js, antes de agregar el link.
        // Si el texto no pasa, este follow-up se detiene (no se reintenta
        // cada 30 min gastando IA).
        const check = validateReplyText(replyResult.text, { businessName: company.name });
        if (!check.ok) {
          await logEvent(db, {
            leadId: lead.id, companyId: lead.companyId, type: EVENT_TYPE.EMAIL_BLOCKED, actor: "system:email_policy",
            detail: { channel: "follow_up", reason: EMAIL_BLOCK_REASON.AI_OUTPUT_REJECTED, violations: check.violations },
          });
          await stopFollowUp(db, lead, "ai_output_rejected");
          continue;
        }

        // Link firmado regenerado (determinístico): los leads de antes de B4
        // tienen guardado un link sin token que el webhook ya no acepta.
        const bookingLink = company.bookingLink
          ? buildBookingLink(company, lead.companyId, lead.id, lead.contact?.name)
          : null;
        let finalText = replyResult.text;
        if (bookingLink) {
          finalText = `${finalText}\n\n${bookingLink}`;
        }

        const newAttempts = attempts + 1;
        const leadRef = db.collection(COLLECTIONS.LEADS).doc(lead.id);
        // El intento se registra ANTES de enviar el email: si el envío sale
        // pero una escritura posterior falla, el catch de abajo no vuelve a
        // intentar en 30 min, así que el lead nunca recibe el mismo
        // recordatorio dos veces.
        //
        // Y se registra en una transacción que vuelve a leer el lead: `lead`
        // viene de la consulta del inicio de la corrida, y entre tanto pudo
        // llegar una reserva (webhook de Cal.com → APPOINTMENT_BOOKED +
        // followUp.stopped), una respuesta del lead, u otra corrida. En ese
        // caso no se envía nada. Queda una ventana mínima entre este commit y
        // el envío del email.
        const reserved = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(leadRef);
          const current = fresh.exists ? fresh.data() : null;
          if (!current || current.status !== LEAD_STATUS.BOOKING_SENT || current.followUp?.stopped ||
            (current.followUp?.attempts ?? 0) !== attempts) {
            return false;
          }
          tx.update(leadRef, {
            "followUp.attempts": newAttempts,
            "followUp.lastSentAt": FieldValue.serverTimestamp(),
            "followUp.lastMessage": {
              text: finalText,
              stage: evalResult.stage,
              generatedAt: FieldValue.serverTimestamp(),
              sentAt: null,
            },
            ...(bookingLink ? { bookingLinkSent: bookingLink } : {}),
            updatedAt: FieldValue.serverTimestamp(),
            aiUsage: FieldValue.arrayUnion(replyResult.usage),
          });
          return true;
        });
        if (!reserved) continue;

        // Solo hay canal de salida por email — un lead que solo dejó
        // teléfono se queda con sentAt: null (sin SMS/WhatsApp todavía para
        // leads de formulario). Una falla de envío no reintenta ni detiene
        // el follow-up: queda en sendError para verlo en el dashboard.
        // Empresas en trial: sujeto al tope diario de ./quota.js. La política
        // de envío (./emailPolicy.js) se vuelve a evaluar dentro del envío.
        if (lead.contact?.email) {
          const emailResult = await sendLeadEmailWithQuota({
            db,
            companyId: lead.companyId,
            to: lead.contact.email,
            company,
            language: replyResult.language,
            text: finalText,
            logContext: `follow-up ${evalResult.stage} lead ${lead.id}`,
            leadId: lead.id,
            channel: "follow_up",
          });
          await leadRef.update({
            "followUp.lastMessage.sentAt": emailResult.sentAt,
            "followUp.lastMessage.emailId": emailResult.emailId,
            "followUp.lastMessage.sendError": emailResult.error,
          });
        }

        await logEvent(db, {
          leadId: lead.id,
          companyId: lead.companyId,
          type: EVENT_TYPE.FOLLOW_UP_SENT,
          actor: "system:follow_up_scheduler",
          detail: { attempt: newAttempts, stage: evalResult.stage, text: finalText },
        });
      } catch (err) {
        console.error(`Error generando follow-up para lead ${lead.id}:`, err);
        // No se marca stopped ni se incrementa attempts — se reintenta en
        // la siguiente corrida del scheduler (30 min después).
      }
    }
  }
);
