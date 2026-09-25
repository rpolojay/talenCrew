"use strict";

const crypto = require("crypto");
const { BOOKING_INTEGRATION_STATUS } = require("./bookingIntegration");

const BOOKING_PROVIDER = {
  CAL: "cal",
};

const VALID_PROVIDERS = Object.values(BOOKING_PROVIDER);
const VALID_STATUSES = Object.values(BOOKING_INTEGRATION_STATUS);

const CONNECTION_ID_RE = /^bc_[a-f0-9]{32}$/;
const MAX_USERNAME_LENGTH = 128;
const MAX_EXTERNAL_ID_LENGTH = 256;

function isBookingConnectionProvider(value) {
  return VALID_PROVIDERS.includes(value);
}

function isBookingConnectionStatus(value) {
  return VALID_STATUSES.includes(value);
}

/*
 * "Active" aquí significa que la conexión sigue siendo una conexión
 * operativa conocida por LeadFlow y puede recibir/diagnosticar eventos.
 *
 * NO significa que la empresa pueda enviar booking links.
 * Para eso sigue mandando isBookingAutomationHealthy(), que exige VERIFIED.
 */
function isBookingConnectionActive(connection) {
  return connection?.status === BOOKING_INTEGRATION_STATUS.PENDING_VERIFICATION ||
    connection?.status === BOOKING_INTEGRATION_STATUS.VERIFIED ||
    connection?.status === BOOKING_INTEGRATION_STATUS.DEGRADED;
}

function isBookingConnectionId(value) {
  return typeof value === "string" && CONNECTION_ID_RE.test(value);
}

function createBookingConnectionId() {
  return `bc_${crypto.randomBytes(16).toString("hex")}`;
}

function isNonEmptyString(value, maxLength = Infinity) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength;
}

/*
 * Valida solamente la estructura del registro de conexión.
 *
 * No valida todavía:
 * - existencia de la empresa;
 * - identidad real en Cal.com;
 * - firma;
 * - webhook externo;
 * - Secret Manager.
 *
 * Esos controles pertenecen a capas posteriores.
 */
function validateBookingConnection(connection) {
  const errors = [];

  if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
    return {
      ok: false,
      errors: ["connection_invalid"],
    };
  }

  if (!isBookingConnectionId(connection.connectionId)) {
    errors.push("connectionId_invalid");
  }

  if (!isNonEmptyString(connection.companyId, 128) || connection.companyId.includes("/")) {
    errors.push("companyId_invalid");
  }

  if (!isBookingConnectionProvider(connection.provider)) {
    errors.push("provider_invalid");
  }

  if (!isBookingConnectionStatus(connection.status)) {
    errors.push("status_invalid");
  }

  if (connection.externalWebhookId != null &&
      !isNonEmptyString(connection.externalWebhookId, MAX_EXTERNAL_ID_LENGTH)) {
    errors.push("externalWebhookId_invalid");
  }

  if (connection.providerUserId != null &&
      !isNonEmptyString(connection.providerUserId, MAX_EXTERNAL_ID_LENGTH)) {
    errors.push("providerUserId_invalid");
  }

  if (connection.providerTeamId != null &&
      !isNonEmptyString(connection.providerTeamId, MAX_EXTERNAL_ID_LENGTH)) {
    errors.push("providerTeamId_invalid");
  }

  if (connection.providerOrganizationId != null &&
      !isNonEmptyString(connection.providerOrganizationId, MAX_EXTERNAL_ID_LENGTH)) {
    errors.push("providerOrganizationId_invalid");
  }

  if (connection.providerUsername != null &&
      !isNonEmptyString(connection.providerUsername, MAX_USERNAME_LENGTH)) {
    errors.push("providerUsername_invalid");
  }

  if (connection.providerEventTypeIds != null &&
      (!Array.isArray(connection.providerEventTypeIds) ||
        connection.providerEventTypeIds.length > 100 ||
        connection.providerEventTypeIds.some(
          (value) => !isNonEmptyString(value, MAX_EXTERNAL_ID_LENGTH)
        ))) {
    errors.push("providerEventTypeIds_invalid");
  }

  /*
   * El secreto nunca pertenece al documento Firestore.
   * Estos campos están prohibidos explícitamente para evitar que alguien
   * termine guardando accidentalmente credenciales en la conexión.
   */
  const forbiddenSecretFields = [
    "secret",
    "webhookSecret",
    "clientSecret",
    "accessToken",
    "refreshToken",
  ];

  for (const field of forbiddenSecretFields) {
    if (Object.prototype.hasOwnProperty.call(connection, field)) {
      errors.push(`${field}_forbidden`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function assertBookingConnection(connection) {
  const result = validateBookingConnection(connection);

  if (!result.ok) {
    const error = new Error(`Invalid booking connection: ${result.errors.join(", ")}`);
    error.code = "INVALID_BOOKING_CONNECTION";
    error.validationErrors = result.errors;
    throw error;
  }

  return connection;
}

module.exports = {
  BOOKING_PROVIDER,
  VALID_PROVIDERS,
  VALID_STATUSES,
  isBookingConnectionProvider,
  isBookingConnectionStatus,
  isBookingConnectionActive,
  isBookingConnectionId,
  createBookingConnectionId,
  validateBookingConnection,
  assertBookingConnection,
};
