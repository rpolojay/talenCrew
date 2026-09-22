const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { COLLECTIONS, LEAD_STATUS, EVENT_TYPE } = require("./constants");
const { GEMINI_API_KEY } = require("./secrets");
const { generateReply } = require("./generateReply");
const { logEvent } = require("./pipeline");

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
      hoursElapsed: hoursSince(lead.autoReply?.generatedAt),
    };
  }
  if (attempts === 1) {
    return {
      stage: "second",
      route: "FOLLOW_UP_SECOND",
      thresholdHours: followUpConfig.delayHoursSecond,
      hoursElapsed: hoursSince(lead.followUp?.lastSentAt),
    };
  }
  return null;
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
  { schedule: "every 30 minutes", secrets: [GEMINI_API_KEY] },
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
      if (!company.followUpConfig) {
        await stopFollowUp(db, lead, "no_follow_up_config");
        continue;
      }
      if (company.followUpConfig.enabled === false) {
        await stopFollowUp(db, lead, "follow_up_disabled_for_company");
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

      try {
        const leadForAI = {
          contact: lead.contact,
          serviceRequested: lead.serviceRequested,
          location: lead.location,
          message: lead.message,
        };
        const replyResult = await generateReply(leadForAI, evalResult.route, company);

        let finalText = replyResult.text;
        if (lead.bookingLinkSent) {
          finalText = `${finalText}\n\n${lead.bookingLinkSent}`;
        }

        const newAttempts = attempts + 1;
        await db.collection(COLLECTIONS.LEADS).doc(lead.id).update({
          "followUp.attempts": newAttempts,
          "followUp.lastSentAt": FieldValue.serverTimestamp(),
          // Mismo patrón que leadflow_leads.autoReply: se genera y se
          // guarda, pero sentAt queda en null.
          //
          // TODO BLOQUEANTE antes de conectar un cliente real (igual criterio
          // que notificationSent en handoff.js): todavía no existe ningún
          // canal de salida real para leads capturados por formulario web
          // (a diferencia de whatsappWebhook, que sí puede responder por
          // WhatsApp). Este mensaje de seguimiento se genera y se registra
          // aquí y en leadflow_lead_events para que quede visible en el
          // dashboard, pero NO se envía a ningún lado — ni email, ni SMS, ni
          // WhatsApp. Cuando exista un canal real conectado a este producto,
          // reemplazar sentAt: null por el envío real y su timestamp.
          "followUp.lastMessage": {
            text: finalText,
            stage: evalResult.stage,
            generatedAt: FieldValue.serverTimestamp(),
            sentAt: null,
          },
          updatedAt: FieldValue.serverTimestamp(),
          aiUsage: FieldValue.arrayUnion(replyResult.usage),
        });

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
