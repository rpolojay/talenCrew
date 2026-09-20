// Barrel de VeloiApp LeadFlow.
// Bloque (b): captura + análisis + scoring + respuesta + handoff automático.
// Bloque Step 3: leadflowCalBookingWebhook — confirma la cita cuando el
// lead agenda vía el link de Cal.com (requiere el secreto CAL_WEBHOOK_SECRET,
// ya creado en Secret Manager).
//
// Deliberadamente NO incluye todavía leadflowFollowUpScheduler — depende de
// un scheduler (Cloud Scheduler / Firestore TTL) que se agrega en un bloque
// aparte.
const { leadflowCaptureLead } = require("./capture");
const { leadflowSeedDemoCompany } = require("./seed");
const { leadflowCalBookingWebhook } = require("./booking");

module.exports = {
  leadflowCaptureLead,
  leadflowSeedDemoCompany,
  leadflowCalBookingWebhook,
};
