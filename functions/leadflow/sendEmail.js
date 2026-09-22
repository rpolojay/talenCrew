const { Resend } = require("resend");
const { Timestamp } = require("firebase-admin/firestore");
const { RESEND_API_KEY } = require("./secrets");

// El dominio leadflow.veloiapp.com tiene que estar verificado en Resend
// (registros SPF/DKIM) — si no, la API rechaza el envío con un 403.
const FROM_EMAIL = "hello@leadflow.veloiapp.com";
const DEFAULT_FROM_NAME = "LeadFlow";

// LeadFlow es multi-tenant: cada empresa envía con su propio nombre (el
// lead conoce el negocio, no la plataforma). Si company.name trae
// caracteres especiales del header From (comas, "<", comillas, ":" ...) se
// envía entre comillas escapadas para que no rompa el header; los saltos de
// línea se eliminan siempre.
function buildFrom(company) {
  const name = (company?.name || "").replace(/[\r\n]+/g, " ").trim() || DEFAULT_FROM_NAME;
  if (/^[\p{L}\p{N} '&-]+$/u.test(name)) return `${name} <${FROM_EMAIL}>`;
  const quoted = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${quoted}" <${FROM_EMAIL}>`;
}

const SUBJECTS = {
  es: (companyName) => `Tu solicitud a ${companyName}`,
  en: (companyName) => `Your request to ${companyName}`,
};

function buildSubject(company, language) {
  const build = SUBJECTS[language] || SUBJECTS[company.language] || SUBJECTS.en;
  return build(company.name);
}

// Envía un correo de texto plano a un lead vía Resend. Nunca lanza: el envío
// es no crítico para el pipeline (el texto ya quedó guardado en el lead), así
// que las fallas se registran y se devuelven para que el caller las guarde.
//
// Devuelve { sentAt, emailId, error }:
//   - éxito: sentAt = Timestamp real del envío, emailId = id de Resend
//   - falla: sentAt = null, error = mensaje
async function sendLeadEmail({ to, company, language, text, logContext }) {
  try {
    const resend = new Resend(RESEND_API_KEY.value());
    // El SDK de Resend no lanza en errores de la API — los devuelve en
    // `error` (dominio sin verificar, rate limit, email inválido, etc.).
    const { data, error } = await resend.emails.send({
      from: buildFrom(company),
      to,
      subject: buildSubject(company, language),
      text,
    });
    if (error) throw new Error(`${error.name || "resend_error"}: ${error.message}`);
    return { sentAt: Timestamp.now(), emailId: data?.id ?? null, error: null };
  } catch (err) {
    console.error(`Fallo el envío de email (${logContext}):`, err);
    return { sentAt: null, emailId: null, error: err.message };
  }
}

module.exports = { sendLeadEmail, buildFrom };
