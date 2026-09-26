const { onRequest } = require("firebase-functions/v2/https");
const cors = require("cors")({ origin: true });
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { resumeAutomation, RESUME_TARGET_STATUSES } = require("./humanReview");
const { LEADFLOW_ADMIN_EMAILS } = require("./adminOutboundEmail");

// Devuelve a la automatización un lead que está en revisión humana
// (HUMAN_REVIEW, marca humanControl o un handoff abierto): resuelve sus
// handoffs abiertos, apaga humanControl y lo pasa a toStatus o a CONTACTED
// (./humanReview.js resumeAutomation). Es la ÚNICA forma de que un lead en
// revisión vuelva a recibir respuestas automáticas: el kanban del dashboard
// también pasa por aquí al sacar una tarjeta de HUMAN_REVIEW, y un cambio de
// status escrito directo desde el navegador no apaga humanControl.
//
// Autorización en el servidor: ID token de Firebase Auth válido y no
// revocado, con email verificado; quien llama tiene que ser miembro
// (allowedUsers) de la empresa DUEÑA del lead, o admin de LeadFlow. Un lead
// de otra empresa responde igual que uno inexistente (404).

const LEAD_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function callerFromRequest(req) {
  const match = (req.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!match) return { status: 401, error: "Missing auth token" };
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(match[1], true);
  } catch {
    return { status: 401, error: "Invalid auth token" };
  }
  const email = typeof decoded.email === "string" ? decoded.email.toLowerCase() : "";
  if (!email || decoded.email_verified !== true) return { status: 403, error: "Forbidden" };
  return { email, isAdmin: LEADFLOW_ADMIN_EMAILS.includes(email) };
}

exports.leadflowResumeAutomation = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const caller = await callerFromRequest(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const { leadId } = body;
    if (typeof leadId !== "string" || !LEAD_ID_RE.test(leadId)) return res.status(400).json({ error: "Invalid leadId" });
    // Opcional: estado de destino elegido por la persona (p. ej. la columna a
    // la que arrastró la tarjeta en el kanban). Nunca BOOKING_SENT.
    const toStatus = body.toStatus ?? null;
    if (toStatus !== null && !RESUME_TARGET_STATUSES.includes(toStatus)) return res.status(400).json({ error: "Invalid toStatus" });

    try {
      const result = await resumeAutomation(getFirestore(), { leadId, callerEmail: caller.email, callerIsAdmin: caller.isAdmin, toStatus });
      if (result.changed) console.log(`Automatización reanudada: lead ${leadId} ${result.fromStatus} -> ${result.status} por ${caller.email}`);
      return res.status(200).json({ leadId, ...result });
    } catch (err) {
      if (err.code === "NOT_FOUND") return res.status(404).json({ error: "Lead not found" });
      console.error(`Error en leadflowResumeAutomation (${leadId}):`, err);
      return res.status(500).json({ error: "Internal error" });
    }
  });
});
