const { defineSecret } = require("firebase-functions/params");

// Mismo secreto ya usado por liveDemoAgent/whatsappWebhook en el index.js
// principal — defineSecret() referencia por nombre, no crea uno nuevo, así
// que este módulo no requiere ningún secreto adicional en Secret Manager.
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

module.exports = { GEMINI_API_KEY };
