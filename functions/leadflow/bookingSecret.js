"use strict";

/*
 * Capa interna para acceder a secretos relacionados con booking.
 *
 * H1.5:
 * - No crea secretos.
 * - No escribe en Secret Manager.
 * - No guarda secretos en Firestore.
 * - No expone secretos al navegador.
 *
 * La implementación actual reutiliza las referencias definidas en
 * ./secrets.js. Más adelante, cuando autoricemos la integración real por
 * conexión, esta capa será el único punto que deberá conocer cómo resolver
 * el secreto asociado a una conexión de proveedor.
 */

const { CAL_WEBHOOK_SECRET } = require("./secrets");

const BOOKING_SECRET_PROVIDER = {
  CAL: "cal",
};

function getCalWebhookSecret() {
  const value = CAL_WEBHOOK_SECRET.value();

  if (!value) {
    const error = new Error("CAL_WEBHOOK_SECRET no está configurado");
    error.code = "BOOKING_SECRET_NOT_CONFIGURED";
    throw error;
  }

  return value;
}

/*
 * H1.5 mantiene solamente el secreto global legacy de Cal.com.
 *
 * La futura resolución por connectionId NO debe implementarse aquí todavía:
 * requerirá Secret Manager y una conexión VERIFIED/PENDING correctamente
 * persistida. Este punto de entrada evita que el resto del dominio conozca
 * cómo se almacenan o recuperan secretos.
 */
function getProviderWebhookSecret(provider) {
  if (provider === BOOKING_SECRET_PROVIDER.CAL) {
    return getCalWebhookSecret();
  }

  const error = new Error(`Proveedor de booking no soportado: ${provider}`);
  error.code = "BOOKING_SECRET_PROVIDER_UNSUPPORTED";
  throw error;
}

module.exports = {
  BOOKING_SECRET_PROVIDER,
  getCalWebhookSecret,
  getProviderWebhookSecret,
};
