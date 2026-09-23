// Validación y normalización del payload público de leadflowCaptureLead.
//
// El endpoint es público (formulario web / snippet de cada cliente), así que
// todo campo se trata como hostil: tipo exacto, largo máximo y formato. Un
// campo con tipo incorrecto se rechaza (400) en vez de coercionarlo, y solo
// los campos conocidos pasan al resto del pipeline — lo demás se ignora.
//
// Además de proteger Firestore (docs < 1 MiB) y el costo de Gemini, esto
// cierra el uso del endpoint como relay de email: contact.email tiene que
// ser UNA dirección válida (nada de arrays, objetos ni listas con comas),
// porque capture.js y followUp.js se la pasan tal cual a Resend como `to`.

const MAX_BODY_BYTES = 32 * 1024;

const LIMITS = {
  companyId: 128,
  message: 4000,
  name: 120,
  email: 254,
  phone: 32,
  companyName: 160,
  serviceRequested: 200,
  location: 200,
  source: 64,
};

const CUSTOM_FIELDS = { maxKeys: 20, keyPattern: /^[A-Za-z0-9_]{1,40}$/, maxValueLength: 500, maxBytes: 4096 };

const COMPANY_ID_RE = /^[A-Za-z0-9_-]+$/;
const SOURCE_RE = /^[A-Za-z0-9_-]+$/;
// Una sola dirección: local@dominio.tld, sin espacios, comas, ;, <> ni
// comillas (que permitirían varios destinatarios o encabezados raros).
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const PHONE_RE = /^\+?[0-9 ().-]+$/;

class ValidationError extends Error {
  constructor(field, status = 400) {
    super(status === 413 ? "Payload too large" : `Invalid field: ${field}`);
    this.status = status;
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;

// Opcional: undefined/null/"" → null. Si viene, tiene que ser string y
// caber en el límite (después de recortar espacios).
function optionalString(value, field, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ValidationError(field);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(field);
  return trimmed || null;
}

function normalizeEmail(value) {
  const email = optionalString(value, "contact.email", LIMITS.email);
  if (email === null) return null;
  const normalized = email.toLowerCase();
  if (!EMAIL_RE.test(normalized) || normalized.includes("..")) throw new ValidationError("contact.email");
  return normalized;
}

function normalizePhone(value) {
  const phone = optionalString(value, "contact.phone", LIMITS.phone);
  if (phone === null) return null;
  const digits = phone.replace(/\D/g, "").length;
  if (!PHONE_RE.test(phone) || digits < 6 || digits > 15) throw new ValidationError("contact.phone");
  return phone;
}

function normalizeCustomFields(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new ValidationError("customFields");
  const keys = Object.keys(value);
  if (keys.length > CUSTOM_FIELDS.maxKeys) throw new ValidationError("customFields");
  const out = {};
  for (const key of keys) {
    if (!CUSTOM_FIELDS.keyPattern.test(key)) throw new ValidationError("customFields");
    const v = value[key];
    if (typeof v === "string") {
      if (v.length > CUSTOM_FIELDS.maxValueLength) throw new ValidationError(`customFields.${key}`);
      out[key] = v;
    } else if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean" || v === null) {
      out[key] = v;
    } else {
      throw new ValidationError(`customFields.${key}`);
    }
  }
  if (Buffer.byteLength(JSON.stringify(out), "utf8") > CUSTOM_FIELDS.maxBytes) throw new ValidationError("customFields");
  return out;
}

function bodySize(body, rawBody) {
  if (rawBody && typeof rawBody.length === "number") return rawBody.length;
  try { return Buffer.byteLength(JSON.stringify(body ?? null), "utf8"); } catch { return Infinity; }
}

// Devuelve { data } con el payload normalizado, o { status, error }.
function validateCapturePayload(body, rawBody) {
  try {
    if (bodySize(body, rawBody) > MAX_BODY_BYTES) throw new ValidationError("body", 413);
    if (!isPlainObject(body)) throw new ValidationError("body");

    if (typeof body.companyId !== "string" || !body.companyId ||
      body.companyId.length > LIMITS.companyId || !COMPANY_ID_RE.test(body.companyId)) {
      throw new ValidationError("companyId");
    }

    if (typeof body.message !== "string") throw new ValidationError("message");
    const message = body.message.trim();
    if (!message || message.length > LIMITS.message) throw new ValidationError("message");

    if (!isPlainObject(body.contact)) throw new ValidationError("contact");
    const contact = {
      name: optionalString(body.contact.name, "contact.name", LIMITS.name),
      email: normalizeEmail(body.contact.email),
      phone: normalizePhone(body.contact.phone),
    };
    if (!contact.email && !contact.phone) throw new ValidationError("contact");

    const source = optionalString(body.source, "source", LIMITS.source);
    if (source !== null && !SOURCE_RE.test(source)) throw new ValidationError("source");

    return {
      data: {
        companyId: body.companyId,
        message,
        contact,
        companyName: optionalString(body.companyName, "companyName", LIMITS.companyName),
        serviceRequested: optionalString(body.serviceRequested, "serviceRequested", LIMITS.serviceRequested),
        location: optionalString(body.location, "location", LIMITS.location),
        customFields: normalizeCustomFields(body.customFields),
        source,
      },
    };
  } catch (err) {
    if (err instanceof ValidationError) return { status: err.status, error: err.message };
    throw err;
  }
}

module.exports = { validateCapturePayload, MAX_BODY_BYTES, LIMITS };
