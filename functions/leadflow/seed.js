// TEMPORAL — solo para crear el doc de leadflow_companies/abc-roofing
// necesario para probar leadflowCaptureLead con datos reales, ya que no hay
// credenciales de Admin SDK/gcloud disponibles localmente en esta sesión.
// Mismo patrón que seedTestBot en index.js: protegida con un header
// comparado contra un secreto ya existente (WHATSAPP_VERIFY_TOKEN, dominio
// distinto pero mismo propósito de "admin-only, temporal"). Se borra
// después de usarse una vez — no debe quedar desplegada.
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { COLLECTIONS } = require("./constants");

const WHATSAPP_VERIFY_TOKEN = defineSecret("WHATSAPP_VERIFY_TOKEN");

exports.leadflowSeedDemoCompany = onRequest({ secrets: [WHATSAPP_VERIFY_TOKEN] }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }
  if (req.get("x-seed-token") !== WHATSAPP_VERIFY_TOKEN.value()) {
    return res.status(401).send("Unauthorized");
  }

  const db = getFirestore();
  await db.collection(COLLECTIONS.COMPANIES).doc("abc-roofing").set({
    name: "ABC Roofing",
    industry: "roofing",
    language: "en",
    timezone: "America/New_York",
    isActive: true,
    createdAt: FieldValue.serverTimestamp(),

    serviceArea: { city: "Miami", state: "FL", radiusMiles: 40 },
    servicesOffered: ["roof replacement", "roof repair", "roof inspection", "storm damage repair"],

    businessFacts: {
      hours: "Mon-Sat 8am-6pm",
      pricingPolicy: "Never state exact prices. Always offer a free on-site estimate.",
      guaranteesPolicy: "Never promise warranty terms. Refer to a written estimate for details.",
      tone: "warm, professional, concise",
    },

    bookingLink: "https://cal.com/abc-roofing/consultation",

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
      sensitiveTopics: ["legal", "injury", "insurance dispute"],
      escalateOnPriceNegotiation: true,
      escalateOnExplicitHumanRequest: true,
    },

    followUpConfig: { enabled: true, delayHoursFirst: 24, delayHoursSecond: 72, maxAttempts: 2 },

    allowedUsers: ["seacrewagency@gmail.com"],
  });

  return res.status(200).json({ companyId: "abc-roofing" });
});
