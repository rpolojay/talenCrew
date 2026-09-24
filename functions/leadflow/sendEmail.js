const { Resend } = require("resend");
const { Timestamp } = require("firebase-admin/firestore");
const { RESEND_API_KEY } = require("./secrets");
const { EMAIL_RE } = require("./captureValidation");

// El dominio leadflow.veloiapp.com tiene que estar verificado en Resend
// (registros SPF/DKIM) — si no, la API rechaza el envío con un 403.
const FROM_EMAIL = "hello@leadflow.veloiapp.com";
const FROM_NAME = "LeadFlow";

// Identidad fija de la plataforma. Antes el display name era company.name,
// que escribe quien se registra un trial: cualquiera podía mandar emails
// desde nuestro dominio con el nombre de otra marca. El negocio aparece en
// el asunto (saneado) y las respuestas del lead le llegan por Reply-To.
function buildFrom() {
  return `${FROM_NAME} <${FROM_EMAIL}>`;
}

// Texto de un solo renglón para un header: sin CR/LF ni otros caracteres de
// control (no se puede inyectar otro header) y con largo acotado.
const MAX_SUBJECT_NAME = 80;
function headerSafe(value, max) {
  const s = String(value ?? "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const SUBJECTS = {
  es: (companyName) => `Tu solicitud a ${companyName}`,
  en: (companyName) => `Your request to ${companyName}`,
};

function buildSubject(company, language) {
  const build = SUBJECTS[language] || SUBJECTS[company.language] || SUBJECTS.en;
  return headerSafe(build(headerSafe(company.name, MAX_SUBJECT_NAME) || FROM_NAME), 200);
}

// Reply-To = email del dueño de la empresa guardado en contactEmail. Para
// las empresas de autoregistro es el email VERIFICADO del token de Google
// (trialSignup.js); las demás las crea un admin. Solo el admin escribe
// leadflow_companies, así que ni el dueño ni el lead lo pueden cambiar. Sin
// un contactEmail válido no se pone Reply-To (no se inventa otra fuente).
function resolveReplyTo(company) {
  const email = typeof company?.contactEmail === "string" ? company.contactEmail.trim().toLowerCase() : "";
  return email && email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

// Envía un correo de texto plano vía Resend. Nunca lanza: ningún envío es
// crítico para el pipeline (el contenido ya quedó guardado en Firestore), así
// que las fallas se registran y se devuelven para que el caller las guarde.
//
// Devuelve { sentAt, emailId, error }:
//   - éxito: sentAt = Timestamp real del envío, emailId = id de Resend
//   - falla: sentAt = null, error = mensaje
async function sendEmail({ from, to, subject, text, replyTo, logContext }) {
  try {
    const resend = new Resend(RESEND_API_KEY.value());
    // El SDK de Resend no lanza en errores de la API — los devuelve en
    // `error` (dominio sin verificar, rate limit, email inválido, etc.).
    const payload = { from, to, subject, text };
    if (replyTo) payload.replyTo = replyTo;
    const { data, error } = await resend.emails.send(payload);
    if (error) throw new Error(`${error.name || "resend_error"}: ${error.message}`);
    return { sentAt: Timestamp.now(), emailId: data?.id ?? null, error: null };
  } catch (err) {
    console.error(`Fallo el envío de email (${logContext}):`, err);
    return { sentAt: null, emailId: null, error: err.message };
  }
}

// Email al lead. Solo se llama desde quota.js, después de la política de
// envío (./emailPolicy.js) y de la cuota.
async function sendLeadEmail({ to, company, language, text, logContext }) {
  return sendEmail({
    from: buildFrom(),
    to,
    subject: buildSubject(company, language),
    text,
    replyTo: resolveReplyTo(company),
    logContext,
  });
}

module.exports = { sendEmail, sendLeadEmail, buildFrom, buildSubject, resolveReplyTo };
