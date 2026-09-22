// Barrel de VeloiApp LeadFlow.
// Bloque (b): captura + análisis + scoring + respuesta + handoff automático.
// Bloque Step 3: leadflowCalBookingWebhook (confirma citas de Cal.com) y
// leadflowFollowUpScheduler (recordatorios automáticos a leads en
// BOOKING_SENT que no han agendado).
const { leadflowCaptureLead } = require("./capture");
const { leadflowSeedDemoCompany } = require("./seed");
const { leadflowCalBookingWebhook } = require("./booking");
const { leadflowFollowUpScheduler } = require("./followUp");

module.exports = {
  leadflowCaptureLead,
  leadflowSeedDemoCompany,
  leadflowCalBookingWebhook,
  leadflowFollowUpScheduler,
};
