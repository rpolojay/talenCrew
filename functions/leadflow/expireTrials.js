const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { COLLECTIONS } = require("./constants");

// Desactiva las empresas de LeadFlow cuyo trial venció. No reutiliza
// deactivateExpiredTrials de VeloiApp: esa función vive fuera de este repo y
// solo conoce las colecciones bots/clients.
//
// Desactivar alcanza para cortar todo: capture.js responde 404 a empresas con
// isActive === false y followUp.js deja de mandarles recordatorios. Sus datos
// siguen visibles en el dashboard.
exports.leadflowExpireTrials = onSchedule({ schedule: "every day 08:00", timeZone: "UTC" }, async () => {
  const db = getFirestore();

  // Un solo filtro de rango (índice automático de campo único); isTrial e
  // isActive se filtran en memoria — son pocas empresas.
  const snap = await db.collection(COLLECTIONS.COMPANIES)
    .where("trialEndsAt", "<=", Timestamp.now())
    .get();

  const expired = snap.docs.filter((d) => d.data().isTrial === true && d.data().isActive !== false);
  for (const doc of expired) {
    await doc.ref.update({ isActive: false, trialExpiredAt: FieldValue.serverTimestamp() });
    console.log(`Trial vencido, empresa desactivada: ${doc.id}`);
  }
});
