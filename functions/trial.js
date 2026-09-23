const { onRequest } = require("firebase-functions/v2/https");
const cors = require("cors")({ origin: true });
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Registro de trial (trial.html). Antes trial.html creaba `clients` y `bots`
// directo desde el navegador, lo que obligaba a dejar `create` público en
// firestore.rules — y cualquiera podía crear un bot activo con el
// whatsappPhoneId de otro negocio. Ahora se crea aquí con el Admin SDK y las
// reglas solo permiten crear clients/bots al admin.
//
// El bot nace inactivo, sin whatsappPhoneId y con allowedUsers = [email]: el
// admin lo conecta a WhatsApp después (admin.html), y el dueño lo ve en
// client.html vía allowedUsers.

const LIMITS = { bizName: 120, contact: 120, email: 254, whatsapp: 40, niche: 60, bizInfo: 4000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildSystemPrompt(bizName, bizInfo) {
  return `Eres el asistente virtual de ${bizName}. Tu función es atender clientes por WhatsApp de forma cálida y profesional.

INFORMACIÓN DEL NEGOCIO:
${bizInfo}

REGLAS:
- Máximo 3 líneas por respuesta
- Tono cálido y colombiano
- Si no sabes algo, di que un asesor te contactará pronto
- Siempre termina con una pregunta o llamado a la acción`;
}

function readPayload(body) {
  const out = {};
  for (const [field, max] of Object.entries(LIMITS)) {
    const value = typeof body?.[field] === "string" ? body[field].trim() : "";
    if (!value) return { error: `Missing field: ${field}` };
    if (value.length > max) return { error: `Field too long: ${field}` };
    out[field] = value;
  }
  out.email = out.email.toLowerCase();
  if (!EMAIL_RE.test(out.email)) return { error: "Invalid email" };
  return { data: out };
}

exports.createTrialSignup = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { data, error } = readPayload(req.body);
    if (error) return res.status(400).json({ error });

    const db = getFirestore();
    try {
      // Un email que ya tiene cuenta no puede registrar otro trial: evita
      // que alguien cree un bot con allowedUsers apuntando al email de un
      // cliente existente y le "cuele" un bot en su dashboard.
      const existing = await db.collection("clients").where("email", "==", data.email).limit(1).get();
      if (!existing.empty) {
        return res.status(409).json({ error: "already_registered" });
      }

      const batch = db.batch();
      const clientRef = db.collection("clients").doc();
      const botRef = db.collection("bots").doc();
      batch.set(clientRef, {
        businessName: data.bizName,
        contactName: data.contact,
        email: data.email,
        whatsapp: data.whatsapp,
        niche: data.niche,
        plan: "trial",
        isActive: false,
        isTrial: true,
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(botRef, {
        botName: data.bizName,
        systemPrompt: buildSystemPrompt(data.bizName, data.bizInfo),
        isActive: false,
        isTrial: true,
        allowedUsers: [data.email],
        createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();

      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error("Error en createTrialSignup:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });
});
