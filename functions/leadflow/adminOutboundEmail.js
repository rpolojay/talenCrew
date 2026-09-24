const { onRequest } = require("firebase-functions/v2/https");
const cors = require("cors")({ origin: true });
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { OUTBOUND_EMAIL_STATUS, setOutboundEmailStatus } = require("./emailPolicy");

// Aprobar o suspender el envío de emails a leads de una empresa
// (outboundEmail.status). Lo usa el botón de admin de leadflow.html.
//
// Autorización en el servidor: ID token de Firebase Auth válido y no
// revocado, email verificado y en LEADFLOW_ADMIN_EMAILS. Un dueño de empresa
// no está en la lista, así que no puede aprobarse a sí mismo (tampoco puede
// escribir el campo desde el navegador: firestore.rules). No hay secretos.

// Mismo listado que isAdmin() en firestore.rules y ADMIN_EMAILS en
// dashboard/leadflow.html — si cambia, hay que cambiar los tres.
const LEADFLOW_ADMIN_EMAILS = ["seacrewagency@gmail.com", "hola@veloiapp.com", "veloiapp@gmail.com"];

// Un admin solo puede pedir estos dos estados; PENDING_REVIEW lo asigna el
// signup y no se vuelve a él.
const TARGET_STATUSES = [OUTBOUND_EMAIL_STATUS.ENABLED, OUTBOUND_EMAIL_STATUS.SUSPENDED];
const COMPANY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_REASON = 300;

const HTTP_BY_CODE = { INVALID_ARGUMENT: 400, NOT_FOUND: 404, INVALID_TRANSITION: 409 };

async function adminEmailFromRequest(req) {
  const match = (req.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!match) return { status: 401, error: "Missing auth token" };
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(match[1], true);
  } catch {
    return { status: 401, error: "Invalid auth token" };
  }
  const email = typeof decoded.email === "string" ? decoded.email.toLowerCase() : "";
  if (!email || decoded.email_verified !== true || !LEADFLOW_ADMIN_EMAILS.includes(email)) {
    return { status: 403, error: "Forbidden" };
  }
  return { email };
}

exports.leadflowSetOutboundEmailStatus = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const auth = await adminEmailFromRequest(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const { companyId, status } = body;
    if (typeof companyId !== "string" || !COMPANY_ID_RE.test(companyId)) return res.status(400).json({ error: "Invalid companyId" });
    if (!TARGET_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
    let reason = null;
    if (body.reason !== undefined && body.reason !== null) {
      if (typeof body.reason !== "string" || body.reason.length > MAX_REASON) return res.status(400).json({ error: "Invalid reason" });
      reason = body.reason.replace(/\s+/g, " ").trim() || null;
    }

    try {
      const result = await setOutboundEmailStatus(getFirestore(), companyId, status, { actor: auth.email, reason });
      console.log(`outboundEmail ${companyId}: ${result.from} -> ${result.to} (${result.changed ? "cambiado" : "sin cambios"}) por ${auth.email}`);
      return res.status(200).json({ companyId, ...result });
    } catch (err) {
      const code = HTTP_BY_CODE[err.code];
      if (code) return res.status(code).json({ error: err.code });
      console.error(`Error en leadflowSetOutboundEmailStatus (${companyId}):`, err);
      return res.status(500).json({ error: "Internal error" });
    }
  });
});

module.exports.LEADFLOW_ADMIN_EMAILS = LEADFLOW_ADMIN_EMAILS;
