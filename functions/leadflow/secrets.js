const { defineSecret } = require("firebase-functions/params");

// Mismo secreto ya usado por liveDemoAgent/whatsappWebhook en el index.js
// principal — defineSecret() referencia por nombre, no crea uno nuevo, así
// que este módulo no requiere ningún secreto adicional en Secret Manager.
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// Firma HMAC del webhook de Cal.com (header X-Cal-Signature-256). Ya
// existe en Secret Manager (creado fuera de este repo).
const CAL_WEBHOOK_SECRET = defineSecret("CAL_WEBHOOK_SECRET");

// API key de Resend para enviar autoReply y follow-ups por email real (ver
// ./sendEmail.js). Creado en Secret Manager con
// `firebase functions:secrets:set RESEND_API_KEY`.
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

// Firma los links de reserva (ver ./bookingToken.js): liga leadId + companyId
// para que leadflowCalBookingWebhook solo acepte reservas que salieron de un
// link emitido por el backend. Es un secreto propio y NO el de Cal.com: el de
// Cal.com también se configura en la cuenta de Cal.com, así que quien la
// administre podría fabricar tokens. Hay que crearlo en Secret Manager antes
// de desplegar (`firebase functions:secrets:set LEADFLOW_BOOKING_TOKEN_SECRET`).
const BOOKING_TOKEN_SECRET = defineSecret("LEADFLOW_BOOKING_TOKEN_SECRET");

module.exports = { GEMINI_API_KEY, CAL_WEBHOOK_SECRET, RESEND_API_KEY, BOOKING_TOKEN_SECRET };
