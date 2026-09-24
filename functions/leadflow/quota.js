const { FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS, EVENT_TYPE } = require("./constants");
const { sendLeadEmail } = require("./sendEmail");
const { evaluateLeadEmailPolicy, EMAIL_BLOCK_REASON } = require("./emailPolicy");
const { logEvent } = require("./pipeline");

// Tope diario de emails automáticos (autoReply + follow-ups) para empresas en
// trial. Las empresas de trial se crean solas desde signup.html, así que sin
// este tope cualquiera podría usar leadflowCaptureLead para mandar emails de
// IA desde hello@leadflow.veloiapp.com a direcciones arbitrarias. Las empresas
// que no son trial no tienen tope.
const TRIAL_DAILY_EMAIL_LIMIT = 50;
const QUOTA_EXCEEDED = "daily_email_quota_exceeded";

// Día en UTC: el contador se reinicia a las 00:00 UTC.
function quotaDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Reserva un envío en el contador del día (transacción, así dos capturas
// simultáneas no se pasan del tope). Si la transacción falla se trata como
// "no permitido": para un trial es preferible no enviar a enviar sin control.
async function reserveTrialEmail(db, companyId, company) {
  if (!company?.isTrial) return true;
  const day = quotaDay();
  const ref = db.collection(COLLECTIONS.EMAIL_QUOTA).doc(`${companyId}_${day}`);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = snap.exists ? snap.data().count || 0 : 0;
      if (count >= TRIAL_DAILY_EMAIL_LIMIT) return false;
      tx.set(ref, { companyId, day, count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
  } catch (err) {
    console.error(`No se pudo reservar cuota de email para ${companyId}:`, err);
    return false;
  }
}

// Evento EMAIL_BLOCKED: solo el canal y el motivo, nunca el contenido del
// email ni el destinatario. Si falla la escritura no se rompe el pipeline.
async function logEmailBlocked(db, { leadId, companyId, channel, reason }) {
  if (!leadId) return;
  try {
    await logEvent(db, { leadId, companyId, type: EVENT_TYPE.EMAIL_BLOCKED, actor: "system:email_policy", detail: { channel, reason } });
  } catch (err) {
    console.error(`No se pudo registrar EMAIL_BLOCKED (${reason}) del lead ${leadId}:`, err);
  }
}

// ÚNICO camino para enviar un email automático a un LEAD (autoReply de
// capture.js y follow-ups de followUp.js). Orden:
//   1) política de envío (./emailPolicy.js) — sin escrituras: un email
//      bloqueado aquí no consume cuota;
//   2) cuota diaria de la empresa (trials);
//   3) envío por Resend con From fijo y Reply-To del dueño (./sendEmail.js).
// Misma forma de respuesta de siempre ({ sentAt, emailId, error }) — error
// lleva el motivo estable del bloqueo — y nunca lanza.
async function sendLeadEmailWithQuota({ db, companyId, company, to, language, text, logContext, leadId, channel = "lead_email" }) {
  const decision = evaluateLeadEmailPolicy(company);
  if (!decision.allowed) {
    console.log(`Email al lead bloqueado por la política (${decision.reason}, ${logContext}, empresa ${companyId})`);
    await logEmailBlocked(db, { leadId, companyId, channel, reason: decision.reason });
    return { sentAt: null, emailId: null, error: decision.reason };
  }
  if (!(await reserveTrialEmail(db, companyId, company))) {
    console.error(`Tope diario de emails de trial alcanzado (${logContext}, empresa ${companyId})`);
    await logEmailBlocked(db, { leadId, companyId, channel, reason: EMAIL_BLOCK_REASON.COMPANY_EMAIL_QUOTA });
    return { sentAt: null, emailId: null, error: QUOTA_EXCEEDED };
  }
  return sendLeadEmail({ to, company, language, text, logContext });
}

module.exports = { sendLeadEmailWithQuota, reserveTrialEmail, TRIAL_DAILY_EMAIL_LIMIT, QUOTA_EXCEEDED };
