const crypto = require("crypto");
const { BOOKING_TOKEN_SECRET } = require("./secrets");

// Vínculo verificable reserva ↔ lead ↔ empresa.
//
// El link de reserva (Cal.com) lleva en metadata leadId, companyId y un token
// HMAC-SHA256 de "leadflow-booking:v1:<companyId>:<leadId>" con un secreto que
// solo tiene el backend. Cal.com copia esa metadata en el payload de
// BOOKING_CREATED, así que el webhook puede comprobar que la reserva salió de
// un link emitido por nosotros para ESE lead de ESA empresa. Cambiar el
// leadId o el companyId del link invalida el token; un token de una empresa
// no sirve para otra.
//
// Cal.com solo guarda un query param en booking.metadata si usa la sintaxis
// con corchetes `metadata[key]=value` — un `?leadId=xxx` plano se ignora.

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN_LENGTH = 22; // base64url de 132 bits
const TOKEN_RE = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`);

function secretValue() {
  const secret = BOOKING_TOKEN_SECRET.value();
  if (!secret) throw new Error("LEADFLOW_BOOKING_TOKEN_SECRET no está configurado");
  return secret;
}

function computeBookingToken(companyId, leadId) {
  if (!ID_RE.test(companyId) || !ID_RE.test(leadId)) throw new Error("companyId/leadId inválido para el token de reserva");
  return crypto.createHmac("sha256", secretValue())
    .update(`leadflow-booking:v1:${companyId}:${leadId}`)
    .digest("base64url")
    .slice(0, TOKEN_LENGTH);
}

// Solo proveedores de reservas conocidos: el link sale por email desde
// nuestro dominio, así que un host arbitrario convertiría el email en un
// vehículo de phishing. Se valida al registrar la empresa (trialSignup.js)
// y otra vez justo antes de usarlo (pipeline.js, buildBookingLink).
const ALLOWED_BOOKING_DOMAINS = ["cal.com", "calendly.com"];

function isAllowedBookingUrl(value) {
  if (typeof value !== "string" || !value) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_BOOKING_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function buildBookingLink(company, companyId, leadId, name) {
  if (!isAllowedBookingUrl(company.bookingLink)) throw new Error("bookingLink no permitido");
  const url = new URL(company.bookingLink);
  url.searchParams.set("metadata[leadId]", leadId);
  url.searchParams.set("metadata[companyId]", companyId);
  url.searchParams.set("metadata[bookingToken]", computeBookingToken(companyId, leadId));
  if (name) url.searchParams.set("name", name);
  return url.toString();
}

// Devuelve { ok: true, leadId, companyId } solo si la metadata trae un token
// válido para exactamente ese par; si no, { ok: false, reason }. No lanza
// por datos del payload (sí si falta el secreto: eso es un error nuestro).
function verifyBookingMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return { ok: false, reason: "no_metadata" };
  const { leadId, companyId, bookingToken } = metadata;
  if (typeof leadId !== "string" || typeof companyId !== "string" || typeof bookingToken !== "string") {
    return { ok: false, reason: "missing_link_fields" };
  }
  if (!ID_RE.test(leadId) || !ID_RE.test(companyId) || !TOKEN_RE.test(bookingToken)) {
    return { ok: false, reason: "malformed_link_fields" };
  }
  const expected = Buffer.from(computeBookingToken(companyId, leadId));
  const received = Buffer.from(bookingToken);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, reason: "invalid_token" };
  }
  return { ok: true, leadId, companyId };
}

module.exports = { buildBookingLink, computeBookingToken, verifyBookingMetadata, isAllowedBookingUrl };
