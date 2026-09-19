// Barrel de VeloiApp LeadFlow. Bloque (b) del plan de implementación:
// captura + análisis + scoring + respuesta + handoff automático.
//
// Deliberadamente NO incluye todavía leadflowCalBookingWebhook ni
// leadflowFollowUpScheduler — dependen de una cuenta de Cal.com conectada
// y de un secreto nuevo (CAL_WEBHOOK_SECRET) que aún no existe en Secret
// Manager. Se agregan en un bloque aparte.
const { leadflowCaptureLead } = require("./capture");
const { leadflowSeedDemoCompany } = require("./seed");

module.exports = {
  leadflowCaptureLead,
  leadflowSeedDemoCompany,
};
