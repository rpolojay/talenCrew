const { defineSecret } = require("firebase-functions/params");

// Mismo secreto ya usado por liveDemoAgent/whatsappWebhook en el index.js
// principal — defineSecret() referencia por nombre, no crea uno nuevo, así
// que este módulo no requiere ningún secreto adicional en Secret Manager.
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// Firma HMAC del webhook de Cal.com (header X-Cal-Signature-256). Ya
// existe en Secret Manager (creado fuera de este repo).
const CAL_WEBHOOK_SECRET = defineSecret("CAL_WEBHOOK_SECRET");

module.exports = { GEMINI_API_KEY, CAL_WEBHOOK_SECRET };
