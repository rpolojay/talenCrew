"use strict";

const {
  SecretManagerServiceClient,
} = require("@google-cloud/secret-manager");

const secretManagerClient = new SecretManagerServiceClient();

function validateSecretRef(secretRef) {
  if (typeof secretRef !== "string" || !secretRef.trim()) {
    const error = new Error("secretRef es requerido");
    error.code = "BOOKING_SECRET_REF_REQUIRED";
    throw error;
  }

  const value = secretRef.trim();

  if (!/^projects\/[^/]+\/secrets\/[^/]+$/.test(value)) {
    const error = new Error("secretRef inválido");
    error.code = "BOOKING_SECRET_REF_INVALID";
    throw error;
  }

  return value;
}

async function accessBookingSecret(secretRef, client = secretManagerClient) {
  const name = `${validateSecretRef(secretRef)}/versions/latest`;

  const [version] = await client.accessSecretVersion({ name });

  const data = version?.payload?.data;

  if (!data) {
    const error = new Error("Secret Manager no devolvió un valor");
    error.code = "BOOKING_SECRET_EMPTY";
    throw error;
  }

  return Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
}

module.exports = {
  validateSecretRef,
  accessBookingSecret,
};
