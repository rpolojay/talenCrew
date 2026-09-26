// Barrel de VeloiApp LeadFlow.
// Bloque (b): captura + análisis + scoring + respuesta + handoff automático.
// Bloque Step 3: leadflowCalBookingWebhook (confirma citas de Cal.com) y
// leadflowFollowUpScheduler (recordatorios automáticos a leads en
// BOOKING_SENT que no han agendado).
// Autoregistro: createLeadflowTrialSignup (dashboard/signup.html) y
// leadflowExpireTrials (desactiva trials vencidos cada día).
// Admin: leadflowSetOutboundEmailStatus (aprueba/suspende el envío de
// emails a leads de una empresa; solo admins autenticados).
// Revisión humana: leadflowResumeAutomation (una persona autorizada devuelve
// a la automatización un lead que estaba en HUMAN_REVIEW).
const { leadflowCaptureLead } = require("./capture");
const { leadflowCalBookingWebhook } = require("./booking");
const { leadflowFollowUpScheduler } = require("./followUp");
const { createLeadflowTrialSignup } = require("./trialSignup");
const { leadflowExpireTrials } = require("./expireTrials");
const { leadflowSetOutboundEmailStatus } = require("./adminOutboundEmail");
const { leadflowResumeAutomation } = require("./resumeAutomation");

module.exports = {
  leadflowCaptureLead,
  leadflowCalBookingWebhook,
  leadflowFollowUpScheduler,
  createLeadflowTrialSignup,
  leadflowExpireTrials,
  leadflowSetOutboundEmailStatus,
  leadflowResumeAutomation,
};
