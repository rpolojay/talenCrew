const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const cors = require("cors")({ origin: true });
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { COLLECTIONS } = require("./constants");

// Autoregistro público de LeadFlow (dashboard/signup.html). Mismo patrón que
// createTrialSignup de VeloiApp (validación estricta, 409 por duplicado,
// escritura atómica con Admin SDK), con una diferencia clave: el trial de
// LeadFlow nace ACTIVO — su companyId ya puede recibir leads en
// leadflowCaptureLead — así que el email tiene que estar verificado. Por eso
// exige un ID token de Firebase Auth (Google Sign-In en signup.html): el email
// de la empresa es el del token, nunca uno escrito en el formulario, y es el
// mismo con el que el usuario entra después a leadflow.html.

const TRIAL_DAYS = 7;
const LIMITS = { bizName: 120, industry: 80, services: 500, city: 80, state: 80 };
const MAX_SERVICES = 15;
const MAX_BOOKING_LINK = 500;

// Valores por defecto razonables para un negocio de servicios local — los
// mismos criterios que el tenant de demo (abc-roofing). El cliente o el admin los
// ajustan después en Firestore.
function defaultCompanyConfig() {
  return {
    businessFacts: {
      hours: "Mon-Fri 9am-5pm",
      pricingPolicy: "Never state exact prices. Offer a free estimate or consultation instead.",
      guaranteesPolicy: "Never promise warranty or guarantee terms. Refer to a written estimate for details.",
      tone: "warm, professional, concise",
    },
    scoringRules: {
      inServiceAreaWeight: 30,
      serviceMatchWeight: 20,
      urgencyWeight: 25,
      completenessWeight: 15,
      otherWeight: 10,
      minScoreToQualify: 60,
    },
    handoffRules: {
      lowConfidenceThreshold: 0.55,
      sensitiveTopics: ["legal", "injury", "insurance dispute", "refund dispute"],
      escalateOnPriceNegotiation: true,
      escalateOnExplicitHumanRequest: true,
    },
    followUpConfig: { enabled: true, delayHoursFirst: 24, delayHoursSecond: 72, maxAttempts: 2 },
  };
}

function readPayload(body) {
  const out = {};
  for (const [field, max] of Object.entries(LIMITS)) {
    const value = typeof body?.[field] === "string" ? body[field].trim() : "";
    if (!value) return { error: `Missing field: ${field}` };
    if (value.length > max) return { error: `Field too long: ${field}` };
    out[field] = value;
  }

  out.servicesOffered = out.services.split(",").map((s) => s.trim()).filter(Boolean);
  if (out.servicesOffered.length === 0) return { error: "Missing field: services" };
  if (out.servicesOffered.length > MAX_SERVICES) return { error: "Too many services" };
  delete out.services;

  if (body.language !== "en" && body.language !== "es") return { error: "Invalid language" };
  out.language = body.language;

  // Opcional. capture.js lo pasa por new URL() y le agrega query params, así
  // que tiene que ser una URL https válida.
  const link = typeof body.bookingLink === "string" ? body.bookingLink.trim() : "";
  if (link) {
    if (link.length > MAX_BOOKING_LINK) return { error: "Field too long: bookingLink" };
    let parsed;
    try { parsed = new URL(link); } catch { return { error: "Invalid bookingLink" }; }
    if (parsed.protocol !== "https:") return { error: "Invalid bookingLink" };
    out.bookingLink = parsed.toString();
  }
  return { data: out };
}

async function verifiedEmailFromRequest(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return { status: 401, error: "Missing auth token" };
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(match[1]);
  } catch {
    return { status: 401, error: "Invalid auth token" };
  }
  if (!decoded.email || decoded.email_verified !== true) {
    return { status: 403, error: "Email not verified" };
  }
  return { email: decoded.email.toLowerCase() };
}

exports.createLeadflowTrialSignup = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const auth = await verifiedEmailFromRequest(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    const email = auth.email;

    const { data, error } = readPayload(req.body);
    if (error) return res.status(400).json({ error });

    const db = getFirestore();
    try {
      // 1) Ya es miembro de alguna empresa (trial previo, o un tenant creado
      //    a mano como abc-roofing): no se le crea otra.
      const existing = await db.collection(COLLECTIONS.COMPANIES)
        .where("allowedUsers", "array-contains", email).limit(1).get();
      if (!existing.empty) {
        return res.status(409).json({ error: "already_registered" });
      }

      // 2) Candado atómico por email: create() falla si el doc ya existe, así
      //    que dos envíos simultáneos (doble clic) no crean dos empresas.
      const lockId = crypto.createHash("sha256").update(email).digest("hex");
      const lockRef = db.collection(COLLECTIONS.TRIAL_SIGNUPS).doc(lockId);
      const companyRef = db.collection(COLLECTIONS.COMPANIES).doc();
      const now = Date.now();

      const batch = db.batch();
      batch.create(lockRef, { email, companyId: companyRef.id, createdAt: FieldValue.serverTimestamp() });
      batch.create(companyRef, {
        name: data.bizName,
        industry: data.industry,
        servicesOffered: data.servicesOffered,
        serviceArea: { city: data.city, state: data.state, radiusMiles: 25 },
        language: data.language,
        ...(data.bookingLink ? { bookingLink: data.bookingLink } : {}),
        contactEmail: email,
        allowedUsers: [email],
        isTrial: true,
        isActive: true,
        trialEndsAt: Timestamp.fromMillis(now + TRIAL_DAYS * 24 * 60 * 60 * 1000),
        createdVia: "self_signup",
        createdAt: FieldValue.serverTimestamp(),
        ...defaultCompanyConfig(),
      });
      try {
        await batch.commit();
      } catch (err) {
        // ALREADY_EXISTS (code 6): el candado ya existía.
        if (err.code === 6) return res.status(409).json({ error: "already_registered" });
        throw err;
      }

      return res.status(201).json({ ok: true, companyId: companyRef.id });
    } catch (err) {
      console.error("Error en createLeadflowTrialSignup:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });
});

module.exports.TRIAL_DAYS = TRIAL_DAYS;
