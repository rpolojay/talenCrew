const { FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS } = require("./constants");
const { sendLeadEmail } = require("./sendEmail");

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

// Igual que sendLeadEmail, pero respetando el tope de trial. Mismo formato de
// respuesta ({ sentAt, emailId, error }) y nunca lanza.
async function sendLeadEmailWithQuota({ db, companyId, company, to, language, text, logContext }) {
  if (!(await reserveTrialEmail(db, companyId, company))) {
    console.error(`Tope diario de emails de trial alcanzado (${logContext}, empresa ${companyId})`);
    return { sentAt: null, emailId: null, error: QUOTA_EXCEEDED };
  }
  return sendLeadEmail({ to, company, language, text, logContext });
}

module.exports = { sendLeadEmailWithQuota, reserveTrialEmail, TRIAL_DAILY_EMAIL_LIMIT, QUOTA_EXCEEDED };
