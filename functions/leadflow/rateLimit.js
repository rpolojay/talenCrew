const { FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS } = require("./constants");

// Límite de capturas por empresa y por hora, además del throttle por
// contacto de capture.js (que se esquiva cambiando de email). Se reserva
// antes de crear el lead y antes de llamar a Gemini, así que una ráfaga de
// capturas contra un mismo companyId no genera ni costo de IA ni emails.
//
// El límite se puede ajustar por empresa con leadflow_companies.captureLimitPerHour
// (solo admin escribe leadflow_companies); si no, depende de si es trial.
const DEFAULT_CAPTURES_PER_HOUR = 100;
const TRIAL_CAPTURES_PER_HOUR = 20;
const MAX_CONFIGURABLE_PER_HOUR = 10000;

function captureLimitFor(company) {
  const custom = company?.captureLimitPerHour;
  if (Number.isInteger(custom) && custom > 0 && custom <= MAX_CONFIGURABLE_PER_HOUR) return custom;
  return company?.isTrial ? TRIAL_CAPTURES_PER_HOUR : DEFAULT_CAPTURES_PER_HOUR;
}

// Hora en UTC ("2026-09-23T14"): el contador se reinicia cada hora.
function hourKey(now = new Date()) {
  return now.toISOString().slice(0, 13);
}

// Transacción: dos capturas simultáneas no pasan del tope. Lanza si
// Firestore falla — capture.js lo trata como "no permitido".
async function reserveCompanyCapture(db, companyId, company) {
  const limit = captureLimitFor(company);
  const hour = hourKey();
  const ref = db.collection(COLLECTIONS.RATE_LIMITS).doc(`capture_${companyId}_${hour}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? snap.data().count || 0 : 0;
    if (count >= limit) return { allowed: false, limit };
    tx.set(ref, { companyId, hour, count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { allowed: true, limit };
  });
}

module.exports = { reserveCompanyCapture, captureLimitFor, hourKey, DEFAULT_CAPTURES_PER_HOUR, TRIAL_CAPTURES_PER_HOUR };
