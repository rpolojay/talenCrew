// E2E aislado de LeadFlow (Phase 1) — SOLO contra Firebase Emulator Suite.
//
//   firebase emulators:exec --only functions,firestore,auth --project demo-leadflow "node tests/leadflow/e2e/run.js"
//
// La Function real corre en el emulador de Functions; Firestore y Auth son
// los emuladores. Gemini y Resend NO salen a internet: functions/.env.demo-leadflow
// (que firebase-tools solo carga con --project demo-leadflow) apunta sus SDK
// a dos mocks HTTP que este script levanta en 127.0.0.1:
//   - Gemini (9911): responde siempre un 400 de API key inválida marcado con
//     [e2e-mock] → se ejercita el camino de fallo de Phase 1
//     (lead → análisis falla → HUMAN_REVIEW → handoff → HANDOFF_CREATED).
//   - Resend (9912): acepta cada envío con un id determinista y lo registra.
// Todos los datos son ficticios.
//
// Antes de escribir nada verifica que el entorno esté aislado (emuladores,
// proyecto demo-, URLs de los SDK en 127.0.0.1, mocks escuchando); si algo
// no cuadra, aborta sin ejecutar ninguna captura.
const fs = require("fs");
const http = require("http");
const path = require("path");
const assert = require("assert");
const { createRequire } = require("module");

const PROJECT = "demo-leadflow";
const COMPANY_ID = "abc-roofing";
const FUNCTIONS_ORIGIN = "http://127.0.0.1:5001";
const CAPTURE_URL = `${FUNCTIONS_ORIGIN}/${PROJECT}/us-central1/leadflowCaptureLead`;
const OPEN_STATUSES = ["OPEN", "ACKNOWLEDGED"];
const EXPECTED_ENV = {
  GCLOUD_PROJECT: PROJECT,
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
};
const FUNCTIONS_DIR = path.resolve(__dirname, "../../../functions");
const MOCK_URL_KEYS = ["GOOGLE_GEMINI_BASE_URL", "RESEND_BASE_URL"];
const MOCK_HOST = "127.0.0.1";
const MOCK_MARKER = "[e2e-mock]";
// Claves falsas de functions/.secret.local: los mocks comprueban que la
// Function las usó (nunca una real).
const FAKE_GEMINI_KEY = "emulator-fake-gemini-key";
const FAKE_RESEND_KEY = "emulator-fake-resend-key";
const OWNER_EMAIL = "owner@example.test";

// Sin esto, el Admin SDK de este script intenta detectar el servidor de
// metadatos de GCE (una petición de red innecesaria). El proceso de
// Functions ya lo recibe así del emulador.
process.env.METADATA_SERVER_DETECTION = "none";

function abort(problems) {
  console.error("ABORTADO — el entorno no está aislado, no se ejecuta nada:\n  - " + problems.join("\n  - "));
  process.exit(2);
}

// ---------- aislamiento: emuladores y proyecto ----------
function assertIsolatedEmulators() {
  const problems = [];
  for (const [key, want] of Object.entries(EXPECTED_ENV)) {
    if (process.env[key] !== want) problems.push(`${key}=${process.env[key]} (se esperaba ${want})`);
  }
  if (!PROJECT.startsWith("demo-")) problems.push("el proyecto no es demo-*");
  if (problems.length) abort(problems);
  console.log(`Aislamiento OK: project=${process.env.GCLOUD_PROJECT} firestore=${process.env.FIRESTORE_EMULATOR_HOST} auth=${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
}

// ---------- aislamiento: URLs que recibe el proceso de Functions ----------
// El proceso de Functions arma su entorno como: entorno de la CLI, luego
// functions/.env, .env.<projectId>, .env.local y por último .secret.local.
// Se lee lo que va a recibir y se exige que ambas URLs sean 127.0.0.1.
function parseDotenv(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function resolveMockUrls() {
  const layers = [".env", `.env.${PROJECT}`, ".env.local", ".secret.local"]
    .map((name) => ({ name, vars: parseDotenv(path.join(FUNCTIONS_DIR, name)) }))
    .filter((l) => l.vars);
  const problems = [];
  const urls = {};
  for (const key of MOCK_URL_KEYS) {
    let value = process.env[key];
    let source = "entorno de la CLI";
    for (const layer of layers) {
      if (layer.vars[key] !== undefined) { value = layer.vars[key]; source = `functions/${layer.name}`; }
    }
    if (!value) { problems.push(`${key} no está definido para el proceso de Functions`); continue; }
    let parsed;
    try { parsed = new URL(value); } catch { problems.push(`${key}=${value} no es una URL válida (${source})`); continue; }
    if (parsed.protocol !== "http:" || parsed.hostname !== MOCK_HOST || !parsed.port) {
      problems.push(`${key}=${value} no apunta a http://${MOCK_HOST}:<puerto> (${source})`);
      continue;
    }
    urls[key] = { url: value, port: Number(parsed.port), source };
  }
  if (problems.length) abort(problems);
  for (const [key, u] of Object.entries(urls)) console.log(`URL local OK: ${key}=${u.url} (${u.source})`);
  return urls;
}

// ---------- mocks HTTP locales ----------
const geminiRequests = [];
const resendRequests = [];

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => resolve(data));
  });
}
function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function geminiHandler(req, res) {
  readBody(req).then((raw) => {
    geminiRequests.push({
      method: req.method,
      path: req.url,
      apiKey: req.headers["x-goog-api-key"] || new URL(req.url, "http://x").searchParams.get("key"),
      body: parseJson(raw),
    });
    // Mismo formato que el 400 real de Gemini con una API key inválida.
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: {
        code: 400,
        message: `${MOCK_MARKER} API key not valid. Please pass a valid API key.`,
        status: "INVALID_ARGUMENT",
        details: [{
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "API_KEY_INVALID",
          domain: "googleapis.com",
          metadata: { service: "generativelanguage.googleapis.com" },
        }],
      },
    }));
  });
}

function resendHandler(req, res) {
  readBody(req).then((raw) => {
    const body = parseJson(raw) || {};
    const id = `e2e-mock-email-${resendRequests.length + 1}`;
    resendRequests.push({
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization || null,
      to: [].concat(body.to || []),
      from: body.from,
      subject: body.subject,
      text: body.text,
      id,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id }));
  });
}

function listen(handler, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(port, MOCK_HOST, () => resolve(server));
  });
}

async function startMocks(urls) {
  const servers = [];
  try {
    servers.push(await listen(geminiHandler, urls.GOOGLE_GEMINI_BASE_URL.port));
    servers.push(await listen(resendHandler, urls.RESEND_BASE_URL.port));
  } catch (err) {
    for (const s of servers) s.close();
    abort([`no se pudo levantar un mock local (${err.code || err.message}); ¿puerto ocupado?`]);
  }
  for (const s of servers) console.log(`Mock escuchando en ${s.address().address}:${s.address().port}`);
  return servers;
}

// ---------- arranque aislado (antes de cualquier escritura o captura) ----------
assertIsolatedEmulators();
const mockUrls = resolveMockUrls();

// firebase-admin desde functions/node_modules. Con FIRESTORE_EMULATOR_HOST
// definido y projectId demo-*, solo puede hablar con el emulador.
const requireFromFunctions = createRequire(path.join(FUNCTIONS_DIR, "package.json"));
const { initializeApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore, FieldValue } = requireFromFunctions("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: PROJECT }));

// ---------- chequeos (se acumulan; un fallo no corta el resto) ----------
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ ok: true, name });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push({ ok: false, name, error: err.message });
    console.log(`  ✖ ${name}\n      ${err.message}`);
  }
}

// ---------- helpers ----------
async function capture(payload) {
  const started = Date.now();
  const resp = await fetch(CAPTURE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: resp.status, body, started, finished: Date.now() };
}

async function getLead(leadId) {
  const snap = await db.collection("leadflow_leads").doc(leadId).get();
  return snap.exists ? snap.data() : null;
}
async function eventsFor(leadId) {
  const snap = await db.collection("leadflow_lead_events").where("leadId", "==", leadId).get();
  return snap.docs.map((d) => d.data());
}
async function handoffsFor(leadId) {
  const snap = await db.collection("leadflow_handoffs").where("leadId", "==", leadId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
const emailsTo = (requests, email) => requests.filter((r) => r.to.includes(email));

async function clearEmulatorFirestore() {
  const resp = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.ok(resp.ok, `no se pudo limpiar el emulador de Firestore: ${resp.status}`);
}

async function seedCompany() {
  await db.collection("leadflow_companies").doc(COMPANY_ID).set({
    name: "ABC Roofing (E2E)",
    industry: "roofing",
    language: "en",
    timezone: "America/New_York",
    isActive: true,
    serviceArea: { city: "Miami", state: "FL", radiusMiles: 40 },
    servicesOffered: ["roof replacement", "roof repair", "roof inspection"],
    businessFacts: {
      hours: "Mon-Sat 8am-6pm",
      pricingPolicy: "Never state exact prices. Always offer a free on-site estimate.",
      guaranteesPolicy: "Never promise warranty terms. Refer to a written estimate for details.",
      tone: "warm, professional, concise",
    },
    bookingLink: "https://cal.example.test/abc-roofing/15min",
    scoringRules: { inServiceAreaWeight: 30, serviceMatchWeight: 20, urgencyWeight: 25, completenessWeight: 15, otherWeight: 10, minScoreToQualify: 60 },
    handoffRules: { lowConfidenceThreshold: 0.55, sensitiveTopics: ["legal", "injury", "insurance dispute"], escalateOnPriceNegotiation: true, escalateOnExplicitHumanRequest: true },
    followUpConfig: { enabled: true, delayHoursFirst: 24, delayHoursSecond: 72, maxAttempts: 2 },
    allowedUsers: [OWNER_EMAIL],
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ---------- escenario 1: Gemini no disponible → HUMAN_REVIEW ----------
async function scenarioAnalysisFailure() {
  console.log("\n[1] lead nuevo con Gemini no disponible (mock local)");
  const leadEmail = "e2e@example.test";
  const message = "Hi, I need a roof inspection in Miami after the storm.";
  const geminiBefore = geminiRequests.length;
  const resendBefore = resendRequests.length;

  const r = await capture({ companyId: COMPANY_ID, message, contact: { name: "E2E Lead", email: leadEmail }, source: "e2e_test" });
  console.log(`  respuesta HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  const geminiCalls = geminiRequests.slice(geminiBefore);
  const resendCalls = resendRequests.slice(resendBefore);

  check("captura responde 201", () => assert.strictEqual(r.status, 201));
  const leadId = r.body.leadId;
  check("la respuesta trae leadId", () => assert.ok(leadId));
  if (!leadId) return;

  const lead = await getLead(leadId);
  check("el lead escrito por la Function existe en el Firestore EMULADO", () => assert.ok(lead));
  if (!lead) return;
  check("lead.status === HUMAN_REVIEW", () => assert.strictEqual(lead.status, "HUMAN_REVIEW"));
  check("el análisis de IA falló (lead.analysis === null)", () => assert.strictEqual(lead.analysis, null));

  // Gemini: la Function real llamó al SDK real, y el SDK llegó al mock local.
  check("Gemini mock recibió la petición de análisis (SDK real → 127.0.0.1, clave falsa)", () => {
    assert.strictEqual(geminiCalls.length, 1, `peticiones recibidas: ${geminiCalls.length}`);
    assert.ok(geminiCalls[0].path.includes(":generateContent"), `path inesperado: ${geminiCalls[0].path}`);
    assert.strictEqual(geminiCalls[0].apiKey, FAKE_GEMINI_KEY);
    assert.ok(JSON.stringify(geminiCalls[0].body).includes(message), "el prompt no contiene el mensaje del lead");
  });

  const events = await eventsFor(leadId);
  console.log(`  eventos: ${events.map((e) => `${e.type}(${e.fromStatus}→${e.toStatus}, ${e.actor})`).join(" | ")}`);
  check("evento de creación del lead (STATUS_CHANGE → NEW)", () =>
    assert.ok(events.some((e) => e.type === "STATUS_CHANGE" && e.toStatus === "NEW")));
  check("evento de fallo/escalamiento (STATUS_CHANGE ANALYZING → HUMAN_REVIEW)", () =>
    assert.ok(events.some((e) => e.type === "STATUS_CHANGE" && e.fromStatus === "ANALYZING" && e.toStatus === "HUMAN_REVIEW")));
  check("evento del handoff (HANDOFF_CREATED)", () =>
    assert.ok(events.some((e) => e.type === "HANDOFF_CREATED"), "no existe ningún evento HANDOFF_CREATED para este lead"));

  const handoffs = await handoffsFor(leadId);
  check("exactamente 1 handoff para el lead", () => assert.strictEqual(handoffs.length, 1));
  check("el handoff está OPEN", () => assert.strictEqual(handoffs[0]?.status, "OPEN"));
  check("handoffId de la respuesta === handoff en Firestore", () => assert.strictEqual(handoffs[0]?.id, r.body.handoffId));
  check("lead.lastHandoffId apunta al handoff", () => assert.strictEqual(lead.lastHandoffId, handoffs[0]?.id));
  // capture.js guarda err.message en el reason del handoff de análisis
  // fallido: el marcador prueba que el error salió del mock local.
  check(`el fallo del análisis contiene ${MOCK_MARKER} (salió del mock, no de Google)`, () =>
    assert.ok((handoffs[0]?.reason || "").includes(MOCK_MARKER), `reason: ${handoffs[0]?.reason}`));

  // Email al lead: el camino de fallo de análisis no llama a sendAutoReplyEmail.
  check("no se envió email al lead (lead.autoReply === null)", () => assert.strictEqual(lead.autoReply, null));
  check("la respuesta HTTP no trae autoReply", () => assert.strictEqual(r.body.autoReply, null));
  check("0 emails al lead en el mock de Resend", () => assert.strictEqual(emailsTo(resendCalls, leadEmail).length, 0));
  check("1 notificación de handoff al owner en el mock de Resend (asunto y contenido)", () => {
    const toOwner = emailsTo(resendCalls, OWNER_EMAIL);
    assert.strictEqual(resendCalls.length, 1, `envíos recibidos: ${resendCalls.length}`);
    assert.strictEqual(toOwner.length, 1);
    assert.strictEqual(toOwner[0].authorization, `Bearer ${FAKE_RESEND_KEY}`);
    assert.ok(toOwner[0].subject.includes("Nuevo caso requiere atención"), `asunto: ${toOwner[0].subject}`);
    assert.ok(toOwner[0].text.includes(message), "el texto no incluye el mensaje del lead");
    assert.ok(toOwner[0].text.includes(leadEmail), "el texto no incluye el contacto del lead");
  });
  check("handoff con notificationSent === true y el id del mock", () => {
    assert.strictEqual(handoffs[0]?.notificationSent, true);
    assert.strictEqual(handoffs[0]?.notificationEmailId, resendCalls[0]?.id);
    assert.strictEqual(handoffs[0]?.notificationError, null);
  });
  console.log(`  Resend mock: ${resendCalls.map((c) => `${c.id} → ${c.to.join(",")} "${c.subject}"`).join(" | ")}`);
}

// ---------- escenario 2: dos llamadas simultáneas → un solo handoff ----------
async function scenarioConcurrency() {
  console.log("\n[2] concurrencia: dos llamadas simultáneas del mismo lead");
  const leadEmail = "e2e-concurrency@example.test";
  const contact = { name: "E2E Concurrency", email: leadEmail };

  // Preparación: el lead queda en HUMAN_REVIEW con un handoff (análisis
  // falla). Se resuelve ese handoff para que las dos llamadas siguientes
  // tengan que CREAR uno nuevo — es la carrera que hay que proteger.
  const first = await capture({ companyId: COMPANY_ID, message: "Roof leak in Miami, please help.", contact, source: "e2e_test" });
  const leadId = first.body.leadId;
  check("preparación: primer lead creado (201)", () => assert.strictEqual(first.status, 201));
  if (!leadId) return;
  const initial = await handoffsFor(leadId);
  check("preparación: 1 handoff inicial", () => assert.strictEqual(initial.length, 1));
  await db.collection("leadflow_handoffs").doc(initial[0].id).update({ status: "RESOLVED", resolvedBy: "e2e@example.test", resolvedAt: FieldValue.serverTimestamp() });

  const eventsBefore = (await eventsFor(leadId)).filter((e) => e.type === "HANDOFF_CREATED").length;
  const resendBefore = resendRequests.length;

  const payload = { companyId: COMPANY_ID, message: "Hello? Is anyone there?", contact, source: "e2e_test" };
  const [a, b] = await Promise.all([capture(payload), capture(payload)]);
  console.log(`  A: HTTP ${a.status} ${JSON.stringify(a.body)}  (${a.finished - a.started} ms)`);
  console.log(`  B: HTTP ${b.status} ${JSON.stringify(b.body)}  (${b.finished - b.started} ms)`);
  const overlap = Math.min(a.finished, b.finished) - Math.max(a.started, b.started);
  console.log(`  solapamiento de las dos peticiones (visto desde el cliente): ${overlap} ms`);
  const resendCalls = resendRequests.slice(resendBefore);

  check("ambas llamadas responden 201", () => { assert.strictEqual(a.status, 201); assert.strictEqual(b.status, 201); });
  check("ambas terminan en HUMAN_REVIEW", () => { assert.strictEqual(a.body.status, "HUMAN_REVIEW"); assert.strictEqual(b.body.status, "HUMAN_REVIEW"); });
  check("ambas asociadas al MISMO handoffId", () => { assert.ok(a.body.handoffId); assert.strictEqual(a.body.handoffId, b.body.handoffId); });
  check("el handoff nuevo no es el que se resolvió", () => assert.notStrictEqual(a.body.handoffId, initial[0].id));

  const handoffs = await handoffsFor(leadId);
  const open = handoffs.filter((h) => OPEN_STATUSES.includes(h.status));
  check("exactamente 1 handoff abierto (OPEN/ACKNOWLEDGED) para el lead", () => assert.strictEqual(open.length, 1));
  check("en total 2 handoffs: el RESOLVED de la preparación + 1 nuevo", () => assert.strictEqual(handoffs.length, 2));

  const eventsAfter = (await eventsFor(leadId)).filter((e) => e.type === "HANDOFF_CREATED").length;
  check("un solo evento HANDOFF_CREATED nuevo", () => assert.strictEqual(eventsAfter - eventsBefore, 1));

  // Una notificación = un envío que llega al mock de Resend; solo se envía
  // al crear (created === true), así que las dos llamadas producen una sola.
  const created = handoffs.find((h) => h.id === a.body.handoffId);
  check("una sola notificación: el mock de Resend recibió 1 envío al owner", () => {
    assert.strictEqual(resendCalls.length, 1, `envíos recibidos: ${resendCalls.length}`);
    assert.strictEqual(emailsTo(resendCalls, OWNER_EMAIL).length, 1);
    assert.strictEqual(emailsTo(resendCalls, leadEmail).length, 0, "hubo un envío al lead");
    assert.strictEqual(created?.notificationSent, true);
    assert.strictEqual(created?.notificationEmailId, resendCalls[0]?.id);
    assert.strictEqual(open.length, 1);
  });

  const lead = await getLead(leadId);
  check("lead.lastHandoffId === handoff nuevo", () => assert.strictEqual(lead.lastHandoffId, a.body.handoffId));
  check("lead.status === HUMAN_REVIEW", () => assert.strictEqual(lead.status, "HUMAN_REVIEW"));
}

async function main() {
  const servers = await startMocks(mockUrls);
  check("mocks de Gemini y Resend escuchando solo en 127.0.0.1", () => {
    for (const s of servers) assert.strictEqual(s.address().address, MOCK_HOST);
  });

  // El Auth emulator responde en su raíz; confirma que está arriba.
  const authResp = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/`);
  check("Auth emulator responde", () => assert.ok(authResp.ok));

  await clearEmulatorFirestore();
  await seedCompany();
  console.log(`Empresa ficticia ${COMPANY_ID} creada en el emulador. URL: ${CAPTURE_URL}`);

  await scenarioAnalysisFailure();
  await scenarioConcurrency();

  // Cada camino ejercitado hace un número fijo de llamadas a los SDK:
  //   análisis fallido (escenario 1 y preparación del 2): 1 Gemini + 1 Resend (notificación)
  //   mensaje adicional ×2 (concurrencia): 2 Gemini c/u (clasificación + respuesta);
  //   1 sola notificación Resend entre las dos (el handoff se crea una vez)
  // Si el mock recibió exactamente esas llamadas, ninguna fue a otro destino.
  console.log(`\nMocks: Gemini recibió ${geminiRequests.length} petición(es), Resend recibió ${resendRequests.length}`);
  check("Gemini: el mock atendió las 6 llamadas que hace el código (ninguna salió a Google)", () => {
    assert.strictEqual(geminiRequests.length, 6);
    assert.ok(geminiRequests.every((g) => g.apiKey === FAKE_GEMINI_KEY), "alguna petición no usó la clave falsa");
  });
  check("Resend: el mock atendió los 3 envíos que hace el código, ninguno a un lead", () => {
    assert.strictEqual(resendRequests.length, 3);
    assert.ok(resendRequests.every((r) => r.to.length === 1 && r.to[0] === OWNER_EMAIL), "hubo un envío a alguien distinto del owner");
  });

  for (const s of servers) s.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESULTADO: ${results.length - failed.length}/${results.length} chequeos OK`);
  for (const f of failed) console.log(`  FALLÓ: ${f.name} — ${f.error}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Error inesperado en el E2E:", err);
  process.exit(1);
});
