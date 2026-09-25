"use strict";

/*
 * Decide qué ruta de procesamiento corresponde a un webhook de booking.
 *
 * H1.5:
 * - Si existe webhookId, intenta resolver por conexión.
 * - Si no existe webhookId, permite únicamente la ruta legacy.
 * - abc-roofing permanece como legacy.
 *
 * Este módulo NO verifica firmas, NO accede a secretos y NO escribe en Firestore.
 */

const LEGACY_GLOBAL_WEBHOOK_COMPANIES = new Set(["abc-roofing"]);

function getWebhookRouting(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("Invalid webhook payload");
    error.code = "INVALID_WEBHOOK_PAYLOAD";
    throw error;
  }

  const webhookId =
    typeof payload.webhookId === "string"
      ? payload.webhookId.trim()
      : "";

  if (webhookId) {
    return {
      route: "connection",
      externalWebhookId: webhookId,
    };
  }

  return {
    route: "legacy",
  };
}

function isLegacyCompanyAllowed(companyId) {
  return LEGACY_GLOBAL_WEBHOOK_COMPANIES.has(companyId);
}

module.exports = {
  getWebhookRouting,
  isLegacyCompanyAllowed,
  LEGACY_GLOBAL_WEBHOOK_COMPANIES,
};
