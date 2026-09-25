"use strict";

const { COLLECTIONS } = require("./constants");
const {
  BOOKING_PROVIDER,
  assertBookingConnection,
} = require("./bookingConnection");

/**
 * Construye la consulta interna para localizar una conexión.
 */
function buildBookingConnectionLookup(provider, externalWebhookId) {
  if (provider !== BOOKING_PROVIDER.CAL) {
    const error = new Error(`Proveedor de booking no soportado: ${provider}`);
    error.code = "BOOKING_PROVIDER_UNSUPPORTED";
    throw error;
  }

  if (
    typeof externalWebhookId !== "string" ||
    !externalWebhookId.trim()
  ) {
    const error = new Error("externalWebhookId requerido");
    error.code = "BOOKING_EXTERNAL_WEBHOOK_ID_REQUIRED";
    throw error;
  }

  return {
    collection: COLLECTIONS.BOOKING_CONNECTIONS,
    field: "externalWebhookId",
    value: externalWebhookId.trim(),
  };
}

/**
 * Valida una conexión ya recuperada.
 */
function validateResolvedBookingConnection(connection) {
  return assertBookingConnection(connection);
}

/**
 * Resuelve una conexión usando una interfaz db compatible con Firestore.
 *
 * No importa firebase-admin directamente para que esta función pueda
 * probarse localmente con un mock.
 */
async function resolveBookingConnection(db, provider, externalWebhookId) {
  const lookup = buildBookingConnectionLookup(provider, externalWebhookId);

  const snapshot = await db
    .collection(lookup.collection)
    .where(lookup.field, "==", lookup.value)
    .limit(2)
    .get();

  if (snapshot.empty) {
    return {
      result: "not_found",
      connection: null,
    };
  }

  if (snapshot.size > 1) {
    const error = new Error("Múltiples booking connections para el mismo webhook");
    error.code = "BOOKING_CONNECTION_NOT_UNIQUE";
    throw error;
  }

  const connection = snapshot.docs[0].data();
  validateResolvedBookingConnection(connection);

  return {
    result: "resolved",
    connection,
  };
}

module.exports = {
  buildBookingConnectionLookup,
  validateResolvedBookingConnection,
  resolveBookingConnection,
};
