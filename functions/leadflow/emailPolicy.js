const { FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS, ADMIN_EVENT_TYPE } = require("./constants");

// Política única para decidir si se puede enviar un email automático a un
// LEAD (autoReply y follow-ups). Los emails de handoff van al equipo de la
// propia empresa y no pasan por aquí.
//
// El permiso de envío (company.outboundEmail.status) es independiente del
// procesamiento de leads: una empresa PENDING_REVIEW o SUSPENDED sigue
// capturando, analizando, calificando y abriendo handoffs — solo no se le
// envía nada al lead. Solo un admin cambia el estado (firestore.rules:
// leadflow_companies es de escritura exclusiva del admin).

const OUTBOUND_EMAIL_STATUS = {
  PENDING_REVIEW: "PENDING_REVIEW",
  ENABLED: "ENABLED",
  SUSPENDED: "SUSPENDED",
};

// Motivos estables de bloqueo (se guardan en autoReply.sendError y en los
// eventos EMAIL_BLOCKED).
const EMAIL_BLOCK_REASON = {
  COMPANY_NOT_FOUND: "COMPANY_NOT_FOUND",
  COMPANY_INACTIVE: "COMPANY_INACTIVE",
  TRIAL_EXPIRED: "TRIAL_EXPIRED",
  DEMO_MODE: "DEMO_MODE",
  EMAIL_PENDING_REVIEW: "EMAIL_PENDING_REVIEW",
  EMAIL_SUSPENDED: "EMAIL_SUSPENDED",
  COMPANY_EMAIL_QUOTA: "COMPANY_EMAIL_QUOTA",
  AI_OUTPUT_REJECTED: "AI_OUTPUT_REJECTED",
};

const VALID_STATUSES = Object.values(OUTBOUND_EMAIL_STATUS);

// Empresas creadas antes de que existiera outboundEmail (no tienen el
// campo). El estado se DERIVA de sus datos, en memoria — nunca se escribe en
// Firestore:
//   - createdVia === "self_signup" → PENDING_REVIEW: un trial de
//     autoregistro que nadie revisó no envía hasta que un admin lo apruebe
//     (desde leadflowSetOutboundEmailStatus);
//   - cualquier otra empresa (creada por un admin) → ENABLED, el
//     comportamiento de siempre. demoMode sigue bloqueando aparte.
// Un status presente pero desconocido falla cerrado (PENDING_REVIEW): un
// dato corrupto nunca habilita el envío.
function resolveOutboundEmailStatus(company) {
  const status = company?.outboundEmail?.status;
  if (status === undefined || status === null) {
    return company?.createdVia === "self_signup" ? OUTBOUND_EMAIL_STATUS.PENDING_REVIEW : OUTBOUND_EMAIL_STATUS.ENABLED;
  }
  return VALID_STATUSES.includes(status) ? status : OUTBOUND_EMAIL_STATUS.PENDING_REVIEW;
}

function toMillis(ts) {
  if (ts && typeof ts.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return null;
}

// Un trial vence por fecha aunque leadflowExpireTrials (una vez al día) no
// lo haya desactivado todavía.
function isTrialExpired(company, now = Date.now()) {
  if (company?.isTrial !== true) return false;
  const endsAt = toMillis(company.trialEndsAt);
  return endsAt !== null && endsAt <= now;
}

// Pasos 1–5 de la política (sin escrituras). La cuota de la empresa (paso 6)
// se reserva después, en quota.js, solo si esto permite el envío — así un
// email bloqueado nunca consume cuota.
function evaluateLeadEmailPolicy(company, now = Date.now()) {
  if (!company) return { allowed: false, reason: EMAIL_BLOCK_REASON.COMPANY_NOT_FOUND };
  if (company.isActive === false) return { allowed: false, reason: EMAIL_BLOCK_REASON.COMPANY_INACTIVE };
  if (isTrialExpired(company, now)) return { allowed: false, reason: EMAIL_BLOCK_REASON.TRIAL_EXPIRED };
  if (company.demoMode === true) return { allowed: false, reason: EMAIL_BLOCK_REASON.DEMO_MODE };
  const status = resolveOutboundEmailStatus(company);
  if (status === OUTBOUND_EMAIL_STATUS.PENDING_REVIEW) return { allowed: false, reason: EMAIL_BLOCK_REASON.EMAIL_PENDING_REVIEW };
  if (status !== OUTBOUND_EMAIL_STATUS.ENABLED) return { allowed: false, reason: EMAIL_BLOCK_REASON.EMAIL_SUSPENDED };
  return { allowed: true, reason: null };
}

// Motivos por los que el email al lead nunca salió por decisión de la
// política (no por una falla de envío). Un lead cuyo último autoReply quedó
// bloqueado así no entra al ciclo de follow-ups: no hay recordatorio de un
// email que el lead nunca recibió.
const POLICY_BLOCK_REASONS = [
  EMAIL_BLOCK_REASON.TRIAL_EXPIRED,
  EMAIL_BLOCK_REASON.EMAIL_PENDING_REVIEW,
  EMAIL_BLOCK_REASON.EMAIL_SUSPENDED,
];

// ---------- Validación del texto generado por la IA ----------

const MAX_REPLY_LENGTH = 1200;

// --- URLs ---
// Con esquema (también las ofuscadas hxxp/hxxps), "www.", o un punto
// ofuscado ([.] o (.)) entre dos palabras.
const SCHEME_OR_WWW_RE = /\b(?:h[xt]{2}ps?|ftp):\/\/\S+|\bwww\s*(?:\.|\[\.\]|\(\.\))\s*\S+|\w\s*(?:\[\.\]|\(\.\))\s*\w/i;
// "evil dot com" / "evil punto com": solo si lo que sigue es un TLD común.
const TLDS = "com|net|org|io|co|app|dev|xyz|info|biz|us|me|ly|link|site|online|shop|store|live|click|top|ru|cn|tk";
const DOT_WORD_RE = new RegExp(`\\b[a-z0-9-]{2,}\\s+(?:dot|punto)\\s+(?:${TLDS})\\b`, "i");
// Dominio suelto (evil.com, evil.com/login). Cada coincidencia se revisa
// aparte: puede ser el nombre del propio negocio o una sigla técnica.
const BARE_DOMAIN_RE = new RegExp(`\\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})\\b(\\/\\S*)?`, "gi");
// Siglas técnicas que tienen forma de dominio pero no se pueden visitar.
const NON_URL_TERMS = new Set(["asp.net", "vb.net", "ado.net"]);

// Dominios que aparecen en el NOMBRE del negocio (p. ej. "RoofPros.com").
// La respuesta puede mencionarlos como nombre — sin esquema, sin "www." y
// sin ruta —; cualquier otra forma sigue contando como URL. El nombre lo
// escribe el negocio y el negocio ya fue revisado antes de poder enviar;
// además solo puede ampliar la lista con dominios de SU PROPIO nombre, no
// cambiar las reglas.
function businessNameDomains(businessName) {
  if (typeof businessName !== "string" || businessName.length > 200) return new Set();
  const found = businessName.toLowerCase().match(new RegExp(BARE_DOMAIN_RE.source, "gi")) || [];
  return new Set(found.filter((d) => !d.includes("/")));
}

function hasUrl(text, businessName) {
  if (SCHEME_OR_WWW_RE.test(text) || DOT_WORD_RE.test(text)) return true;
  const allowed = businessNameDomains(businessName);
  for (const m of text.matchAll(BARE_DOMAIN_RE)) {
    const token = m[0].toLowerCase();
    const hasPath = Boolean(m[1]);
    if (!hasPath && (NON_URL_TERMS.has(token) || allowed.has(token))) continue;
    return true;
  }
  return false;
}

// --- Emails ---
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// --- Teléfonos ---
// Una secuencia de dígitos NO cuenta como teléfono por sí sola (fechas,
// rangos de años, precios, números de caso o de licencia). Cuenta si tiene
// forma de teléfono:
//   - internacional: "+" y 7–15 dígitos en grupos (+34 612 345 678);
//   - Norteamérica: 3-3-4 con separadores de teléfono ((305) 555-0123,
//     305.555.0123, 305 555 0123, +1 305-555-0123);
// o si va precedida de una palabra que dice que es un teléfono (llame al…,
// call…, tel., WhatsApp…) y tiene 7–15 dígitos.
const INTL_PHONE_RE = /(?<![\w$€£])\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}(?![\w])/;
const NANP_PHONE_RE = /(?<![\w$€£.,])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\w.,]?\d)/;
const PHONE_CONTEXT_RE = /\b(?:call|phone|tel|telephone|text|sms|whats\s?app|mobile|cell|ll[aá]m[ae](?:nos)?|llamar|tel[eé]fono|celular|m[oó]vil)\b[^\d\n]{0,20}(\+?\d[\d\s().-]{5,20}\d)/i;

const phoneLikeDigits = (s) => { const n = s.replace(/\D/g, "").length; return n >= 7 && n <= 15; };

function hasPhone(text) {
  for (const re of [INTL_PHONE_RE, NANP_PHONE_RE]) {
    const m = text.match(re);
    if (m && phoneLikeDigits(m[0])) return true;
  }
  const ctx = text.match(PHONE_CONTEXT_RE);
  return Boolean(ctx && phoneLikeDigits(ctx[1]));
}

// El texto que escribió la IA, ANTES de que el código agregue el link de
// reserva. Si falla, no se envía nada (capture.js lo escala a una persona).
// businessName (opcional): el nombre de la empresa, para no rechazar su
// propia mención cuando el nombre es un dominio (ver businessNameDomains).
function validateReplyText(text, { businessName } = {}) {
  const violations = [];
  if (typeof text !== "string" || !text.trim()) violations.push("empty");
  else {
    if (text.length > MAX_REPLY_LENGTH) violations.push("too_long");
    if (hasUrl(text, businessName)) violations.push("url");
    if (EMAIL_RE.test(text)) violations.push("email");
    if (hasPhone(text)) violations.push("phone");
  }
  return { ok: violations.length === 0, violations };
}

// ---------- Transiciones de estado (solo admin / backend) ----------

// PENDING_REVIEW → ENABLED, ENABLED → SUSPENDED, SUSPENDED → ENABLED.
const ALLOWED_TRANSITIONS = {
  [OUTBOUND_EMAIL_STATUS.PENDING_REVIEW]: [OUTBOUND_EMAIL_STATUS.ENABLED],
  [OUTBOUND_EMAIL_STATUS.ENABLED]: [OUTBOUND_EMAIL_STATUS.SUSPENDED],
  [OUTBOUND_EMAIL_STATUS.SUSPENDED]: [OUTBOUND_EMAIL_STATUS.ENABLED],
};

function isAllowedTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

function policyError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Cambia outboundEmail.status en una transacción (Admin SDK). La llama el
// endpoint de admin (./adminOutboundEmail.js), que ya verificó que quien la
// pide es admin. Idempotente: pedir el estado actual no escribe nada. Cada
// transición a ENABLED (desde PENDING_REVIEW o desde SUSPENDED) guarda un
// enabledAt nuevo, que followUp.js usa para no mandar follow-ups atrasados.
// Cada cambio real deja un evento en leadflow_admin_events (solo backend).
async function setOutboundEmailStatus(db, companyId, nextStatus, { actor, reason = null } = {}) {
  if (!VALID_STATUSES.includes(nextStatus)) throw policyError("INVALID_ARGUMENT", `Invalid outboundEmail status: ${nextStatus}`);
  if (typeof actor !== "string" || !actor.trim()) throw policyError("INVALID_ARGUMENT", "actor is required");
  const ref = db.collection(COLLECTIONS.COMPANIES).doc(companyId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw policyError("NOT_FOUND", `Company not found: ${companyId}`);
    const current = resolveOutboundEmailStatus(snap.data());
    if (current === nextStatus) return { from: current, to: nextStatus, changed: false };
    if (!isAllowedTransition(current, nextStatus)) {
      throw policyError("INVALID_TRANSITION", `Transition not allowed: ${current} -> ${nextStatus}`);
    }
    const update = {
      "outboundEmail.status": nextStatus,
      "outboundEmail.updatedAt": FieldValue.serverTimestamp(),
      "outboundEmail.updatedBy": actor.trim(),
    };
    if (nextStatus === OUTBOUND_EMAIL_STATUS.ENABLED) update["outboundEmail.enabledAt"] = FieldValue.serverTimestamp();
    tx.update(ref, update);
    tx.set(db.collection(COLLECTIONS.ADMIN_EVENTS).doc(), {
      type: ADMIN_EVENT_TYPE.OUTBOUND_EMAIL_STATUS_CHANGED,
      companyId,
      from: current,
      to: nextStatus,
      actor: actor.trim(),
      reason,
      timestamp: FieldValue.serverTimestamp(),
    });
    return { from: current, to: nextStatus, changed: true };
  });
}

module.exports = {
  OUTBOUND_EMAIL_STATUS,
  EMAIL_BLOCK_REASON,
  POLICY_BLOCK_REASONS,
  resolveOutboundEmailStatus,
  evaluateLeadEmailPolicy,
  validateReplyText,
  setOutboundEmailStatus,
};
