// Pruebas locales del autoregistro de LeadFlow y lo que lo rodea: signup,
// tope diario de emails de trial, camino sin bookingLink, follow-ups de
// empresas inactivas y vencimiento de trials. Todo mockeado (Firestore, Auth,
// Resend, Gemini, firebase-functions) — cero llamadas de red.
//
//   node --test tests/leadflow/
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");
const Module = require("module");
const path = require("path");

const LF = path.join(__dirname, "../../functions/leadflow");

// ---------- Firestore en memoria ----------
class Ts {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  static now() { return new Ts(Date.now()); }
  static fromMillis(ms) { return new Ts(ms); }
}
const SERVER_TS = { __serverTs: true };
const FieldValue = { serverTimestamp: () => SERVER_TS, arrayUnion: (...items) => ({ __arrayUnion: items }) };

let store;
let autoId;
function resolve(v, prev) {
  if (v === SERVER_TS) return Ts.now();
  if (v && v.__arrayUnion) return [...(prev || []), ...v.__arrayUnion];
  if (v && typeof v === "object" && !(v instanceof Ts) && !Array.isArray(v)) {
    const o = {}; for (const k of Object.keys(v)) o[k] = resolve(v[k]); return o;
  }
  return v;
}
function applyUpdate(doc, data) {
  for (const [k, v] of Object.entries(data)) {
    const parts = k.split("."); let o = doc;
    for (const p of parts.slice(0, -1)) { o[p] = o[p] ?? {}; o = o[p]; }
    const last = parts[parts.length - 1]; o[last] = resolve(v, o[last]);
  }
}
function docRef(col, id) {
  store[col] = store[col] || {};
  return {
    col, id,
    async get() { const d = store[col][id]; return { exists: !!d, data: () => d, id, ref: this }; },
    async set(data) { store[col][id] = resolve(data); },
    async update(data) {
      if (!store[col][id]) throw new Error(`update on missing doc ${col}/${id}`);
      applyUpdate(store[col][id], data);
    },
  };
}
function matches(d, [field, op, val]) {
  const v = field.split(".").reduce((o, k) => o?.[k], d);
  if (op === "==") return v === val;
  if (op === "array-contains") return Array.isArray(v) && v.includes(val);
  if (op === "<=") return v instanceof Ts && v.toMillis() <= val.toMillis();
  throw new Error(`op no soportado: ${op}`);
}
function queryRef(col, filters = [], max = Infinity) {
  return {
    where: (f, op, v) => queryRef(col, [...filters, [f, op, v]], max),
    limit: (n) => queryRef(col, filters, n),
    async get() {
      const docs = Object.entries(store[col] || {})
        .filter(([, d]) => filters.every((f) => matches(d, f)))
        .slice(0, max)
        .map(([id, d]) => ({ id, data: () => d, ref: docRef(col, id) }));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
}
const db = {
  collection(col) {
    store[col] = store[col] || {};
    return {
      doc: (id) => docRef(col, id ?? `auto${++autoId}`),
      async add(data) { const id = `ev${++autoId}`; store[col][id] = resolve(data); return docRef(col, id); },
      where: (f, op, v) => queryRef(col).where(f, op, v),
      limit: (n) => queryRef(col).limit(n),
      get: () => queryRef(col).get(),
    };
  },
  batch() {
    const ops = [];
    return {
      create: (ref, data) => ops.push(["create", ref, data]),
      set: (ref, data) => ops.push(["set", ref, data]),
      async commit() {
        // Todo o nada, como Firestore: si un create choca, no se escribe nada.
        for (const [op, ref] of ops) {
          if (op === "create" && store[ref.col]?.[ref.id]) {
            const err = new Error("ALREADY_EXISTS"); err.code = 6; throw err;
          }
        }
        for (const [, ref, data] of ops) { store[ref.col] = store[ref.col] || {}; store[ref.col][ref.id] = resolve(data); }
      },
    };
  },
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, data, opts) => writes.push([ref, data, opts]),
    };
    const result = await fn(tx);
    for (const [ref, data, opts] of writes) {
      store[ref.col] = store[ref.col] || {};
      if (opts?.merge && store[ref.col][ref.id]) applyUpdate(store[ref.col][ref.id], data);
      else store[ref.col][ref.id] = resolve(data);
    }
    return result;
  },
};

// ---------- Auth, Resend, Gemini, firebase-functions ----------
const TOKENS = {
  "tok-ana": { email: "Ana@Example.com", email_verified: true },
  "tok-bob": { email: "bob@example.com", email_verified: true },
  "tok-unverified": { email: "eve@example.com", email_verified: false },
  "tok-owner": { email: "owner@abc.com", email_verified: true },
};
let resendCalls;
let replyCalls;
let analysisResult;
class FakeResend {
  constructor() { this.emails = { send: async (p) => { resendCalls.push(p); return { data: { id: `email_${resendCalls.length}` }, error: null }; } }; }
}

const moduleMocks = {
  resend: { Resend: FakeResend },
  "firebase-admin/firestore": { getFirestore: () => db, FieldValue, Timestamp: Ts },
  "firebase-admin/auth": {
    getAuth: () => ({
      verifyIdToken: async (t) => { if (!TOKENS[t]) throw new Error("invalid token"); return TOKENS[t]; },
    }),
  },
  "firebase-functions/v2/https": { onRequest: (a, b) => b || a },
  "firebase-functions/v2/scheduler": { onSchedule: (_opts, h) => h },
  "firebase-functions/params": { defineSecret: (name) => ({ name, value: () => `fake-${name}` }) },
  cors: () => (req, res, next) => next(),
};
const localMocks = {
  [path.join(LF, "analyzeLead.js")]: { analyzeLead: async () => ({ analysis: analysisResult, usage: { step: "analysis" } }) },
  [path.join(LF, "geminiSchemas.js")]: { validateAnalysis: () => {} },
  [path.join(LF, "scoring.js")]: { scoreLead: () => ({ adjusted: 90, inServiceArea: true }) },
  [path.join(LF, "generateReply.js")]: {
    generateReply: async (_l, route, company, lang) => {
      replyCalls.push({ route, lang });
      return { text: `Respuesta IA (${route})`, language: lang || company.language, usage: { step: "reply" } };
    },
  },
  [path.join(LF, "detectLanguage.js")]: { detectMessageLanguage: async () => ({ detectedLanguage: "es", usage: { step: "lang" } }) },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  if (moduleMocks[request]) return moduleMocks[request];
  if (parent && request.startsWith(".")) {
    const full = Module._resolveFilename(request, parent);
    if (localMocks[full]) return localMocks[full];
  }
  return origLoad.apply(this, arguments);
};
console.error = () => {};
console.log = ((log) => (...a) => { if (!String(a[0]).startsWith("Trial vencido")) log(...a); })(console.log);

const { createLeadflowTrialSignup } = require(path.join(LF, "trialSignup.js"));
const { leadflowCaptureLead } = require(path.join(LF, "capture.js"));
const { leadflowFollowUpScheduler } = require(path.join(LF, "followUp.js"));
const { leadflowExpireTrials } = require(path.join(LF, "expireTrials.js"));
const { decideRoute, statusForRoute } = require(path.join(LF, "pipeline.js"));
const { TRIAL_DAILY_EMAIL_LIMIT } = require(path.join(LF, "quota.js"));

// ---------- helpers ----------
function call(handler, { method = "POST", body = {}, token } = {}) {
  return new Promise((done) => {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const req = { method, body, get: (h) => headers[h.toLowerCase()] };
    const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { done({ code: this.code, body: b }); } };
    handler(req, res);
  });
}
const signup = (body, token = "tok-ana") => call(createLeadflowTrialSignup, { body, token });
const capture = (body) => call(leadflowCaptureLead, { body });
const validForm = () => ({ bizName: "Techos Sol", industry: "roofing", services: "roof repair, roof replacement , gutters", city: "Miami", state: "FL", language: "es" });
const companies = () => Object.entries(store.leadflow_companies || {});
const day = () => new Date().toISOString().slice(0, 10);

const baseCompany = {
  industry: "roofing", language: "en", isActive: true,
  servicesOffered: ["roof repair"], serviceArea: { city: "Miami", state: "FL", radiusMiles: 25 },
  businessFacts: { hours: "9-5", pricingPolicy: "x", guaranteesPolicy: "x", tone: "warm" },
  scoringRules: { minScoreToQualify: 60 },
  followUpConfig: { enabled: true, delayHoursFirst: 24, delayHoursSecond: 72, maxAttempts: 2 },
};

beforeEach(() => {
  store = {};
  autoId = 0;
  resendCalls = [];
  replyCalls = [];
  analysisResult = { detected_language: "es", qualification: "qualified", needs_human: false, reason: "ok", confidence: 0.9 };
  store.leadflow_companies = {
    "abc-roofing": { ...baseCompany, name: "ABC Roofing", bookingLink: "https://cal.com/abc/15min", allowedUsers: ["owner@abc.com"] },
  };
});

describe("createLeadflowTrialSignup — autenticación", () => {
  test("sin token → 401, no crea nada", async () => {
    const r = await call(createLeadflowTrialSignup, { body: validForm() });
    assert.strictEqual(r.code, 401);
    assert.strictEqual(companies().length, 1);
  });
  test("token inválido → 401", async () => {
    assert.strictEqual((await signup(validForm(), "tok-falso")).code, 401);
  });
  test("email sin verificar → 403", async () => {
    assert.strictEqual((await signup(validForm(), "tok-unverified")).code, 403);
    assert.strictEqual(companies().length, 1);
  });
  test("GET → 405", async () => {
    assert.strictEqual((await call(createLeadflowTrialSignup, { method: "GET", token: "tok-ana" })).code, 405);
  });
});

describe("createLeadflowTrialSignup — alta", () => {
  test("válido → 201 con la empresa completa y el email del TOKEN", async () => {
    const before = Date.now();
    const r = await signup({ ...validForm(), email: "otro@hacker.com" });
    assert.strictEqual(r.code, 201);
    const c = store.leadflow_companies[r.body.companyId];
    assert.ok(c, "la empresa existe con el companyId devuelto");
    assert.strictEqual(c.name, "Techos Sol");
    assert.strictEqual(c.industry, "roofing");
    assert.deepStrictEqual(c.servicesOffered, ["roof repair", "roof replacement", "gutters"]);
    assert.deepStrictEqual(c.serviceArea, { city: "Miami", state: "FL", radiusMiles: 25 });
    assert.strictEqual(c.language, "es");
    assert.strictEqual(c.contactEmail, "ana@example.com", "email del token, en minúsculas, no el del body");
    assert.deepStrictEqual(c.allowedUsers, ["ana@example.com"]);
    assert.strictEqual(c.isTrial, true);
    assert.strictEqual(c.isActive, true);
    const days = (c.trialEndsAt.toMillis() - before) / 864e5;
    assert.ok(days > 6.99 && days < 7.01, `trialEndsAt a +7 días (${days})`);
    assert.ok(!("bookingLink" in c), "sin bookingLink si no se mandó");
    for (const k of ["businessFacts", "scoringRules", "handoffRules", "followUpConfig"]) assert.ok(c[k], `default ${k}`);
    assert.strictEqual(c.scoringRules.minScoreToQualify, 60);
    assert.strictEqual(Object.keys(store.leadflow_trial_signups).length, 1, "candado creado");
  });
  test("campos inyectados en el body se ignoran", async () => {
    const r = await signup({ ...validForm(), allowedUsers: ["x@x.com"], isActive: false, isTrial: false, trialEndsAt: "2099-01-01", companyId: "abc-roofing" });
    const c = store.leadflow_companies[r.body.companyId];
    assert.notStrictEqual(r.body.companyId, "abc-roofing");
    assert.deepStrictEqual(c.allowedUsers, ["ana@example.com"]);
    assert.strictEqual(c.isTrial, true);
    assert.ok(c.trialEndsAt instanceof Ts);
    assert.strictEqual(store.leadflow_companies["abc-roofing"].name, "ABC Roofing", "abc-roofing intacta");
  });
  test("bookingLink https válido se guarda", async () => {
    const r = await signup({ ...validForm(), bookingLink: " https://cal.com/techos-sol/30min " });
    assert.strictEqual(store.leadflow_companies[r.body.companyId].bookingLink, "https://cal.com/techos-sol/30min");
  });
});

describe("createLeadflowTrialSignup — duplicados (409)", () => {
  test("segundo registro con el mismo email", async () => {
    assert.strictEqual((await signup(validForm())).code, 201);
    const r = await signup({ ...validForm(), bizName: "Otra" });
    assert.strictEqual(r.code, 409);
    assert.strictEqual(r.body.error, "already_registered");
    assert.strictEqual(companies().length, 2);
  });
  test("email que ya es miembro de un tenant existente (abc-roofing)", async () => {
    assert.strictEqual((await signup(validForm(), "tok-owner")).code, 409);
    assert.strictEqual(companies().length, 1);
  });
  test("carrera: candado ya existe → 409 y no se crea ninguna empresa (batch todo o nada)", async () => {
    const crypto = require("crypto");
    store.leadflow_trial_signups = { [crypto.createHash("sha256").update("bob@example.com").digest("hex")]: { email: "bob@example.com" } };
    const r = await signup(validForm(), "tok-bob");
    assert.strictEqual(r.code, 409);
    assert.strictEqual(companies().length, 1);
  });
});

describe("createLeadflowTrialSignup — validación (400)", () => {
  const cases = [
    ["falta ciudad", { city: "" }],
    ["falta industria", { industry: "  " }],
    ["idioma inválido", { language: "fr" }],
    ["servicios vacíos", { services: " , , " }],
    ["demasiados servicios", { services: Array.from({ length: 16 }, (_, i) => `s${i}`).join(",") }],
    ["nombre demasiado largo", { bizName: "x".repeat(121) }],
    ["bookingLink http", { bookingLink: "http://cal.com/x" }],
    ["bookingLink no es URL", { bookingLink: "no es un link" }],
    ["bookingLink javascript:", { bookingLink: "javascript:alert(1)" }],
    ["campo no string", { bizName: { $ne: "" } }],
  ];
  for (const [name, patch] of cases) {
    test(name, async () => {
      const r = await signup({ ...validForm(), ...patch });
      assert.strictEqual(r.code, 400, JSON.stringify(r.body));
      assert.strictEqual(companies().length, 1);
    });
  }
});

describe("pipeline — camino sin bookingLink", () => {
  const analysis = { needs_human: false, qualification: "qualified" };
  test("con link → QUALIFIED (BOOKING_SENT); sin link → QUALIFIED_NO_BOOKING (CONTACTED)", () => {
    const score = { adjusted: 90, inServiceArea: true };
    assert.strictEqual(decideRoute({ analysis, score, company: { bookingLink: "https://x.com" } }), "QUALIFIED");
    assert.strictEqual(decideRoute({ analysis, score, company: {} }), "QUALIFIED_NO_BOOKING");
    assert.strictEqual(statusForRoute("QUALIFIED"), "BOOKING_SENT");
    assert.strictEqual(statusForRoute("QUALIFIED_NO_BOOKING"), "CONTACTED");
  });
  test("score bajo sin link sigue siendo NEEDS_INFO", () => {
    assert.strictEqual(decideRoute({ analysis, score: { adjusted: 10 }, company: {} }), "NEEDS_INFO");
  });
});

describe("capture — empresa de trial", () => {
  async function trialCompany(extra = {}) {
    const r = await signup({ ...validForm(), ...extra });
    return r.body.companyId;
  }
  test("sin bookingLink: lead calificado queda CONTACTED, sin link en el email", async () => {
    const companyId = await trialCompany();
    const r = await capture({ companyId, message: "Necesito reparar el techo en Miami", contact: { name: "Luis", email: "luis@example.com" } });
    assert.strictEqual(r.code, 201);
    assert.strictEqual(r.body.status, "CONTACTED");
    assert.strictEqual(replyCalls[0].route, "QUALIFIED_NO_BOOKING");
    assert.strictEqual(resendCalls.length, 1);
    assert.ok(!/https?:\/\//.test(resendCalls[0].text), "sin URL en el email");
    const lead = Object.values(store.leadflow_leads)[0];
    assert.strictEqual(lead.bookingLinkSent, null);
    assert.strictEqual(resendCalls[0].from, "Techos Sol <hello@leadflow.veloiapp.com>");
  });
  test("con bookingLink: flujo normal (BOOKING_SENT + link)", async () => {
    const companyId = await trialCompany({ bookingLink: "https://cal.com/techos-sol/30min" });
    const r = await capture({ companyId, message: "Necesito reparar el techo", contact: { email: "luis@example.com" } });
    assert.strictEqual(r.body.status, "BOOKING_SENT");
    assert.ok(resendCalls[0].text.includes("https://cal.com/techos-sol/30min?metadata%5BleadId%5D="));
  });
  test(`tope diario: el envío ${TRIAL_DAILY_EMAIL_LIMIT} sale, el ${TRIAL_DAILY_EMAIL_LIMIT + 1} no — el lead se captura igual`, async () => {
    const companyId = await trialCompany();
    store.leadflow_email_quota = { [`${companyId}_${day()}`]: { companyId, day: day(), count: TRIAL_DAILY_EMAIL_LIMIT - 1 } };

    const ok = await capture({ companyId, message: "hola", contact: { email: "a@example.com" } });
    assert.strictEqual(ok.code, 201);
    assert.strictEqual(resendCalls.length, 1);
    assert.strictEqual(store.leadflow_email_quota[`${companyId}_${day()}`].count, TRIAL_DAILY_EMAIL_LIMIT);

    const blocked = await capture({ companyId, message: "hola", contact: { email: "b@example.com" } });
    assert.strictEqual(blocked.code, 201, "la captura no se rompe");
    assert.strictEqual(resendCalls.length, 1, "no se envió el segundo");
    const lead = store.leadflow_leads[blocked.body.leadId];
    assert.strictEqual(lead.autoReply.sentAt, null);
    assert.strictEqual(lead.autoReply.sendError, "daily_email_quota_exceeded");
    assert.ok(lead.autoReply.text, "el texto igual queda guardado");
  });
  test("la cuota es por empresa y por día: otra empresa de trial no se ve afectada", async () => {
    const a = await trialCompany();
    store.leadflow_email_quota = { [`${a}_${day()}`]: { count: TRIAL_DAILY_EMAIL_LIMIT } };
    const b = (await signup(validForm(), "tok-bob")).body.companyId;
    await capture({ companyId: b, message: "hola", contact: { email: "c@example.com" } });
    assert.strictEqual(resendCalls.length, 1);
    store.leadflow_email_quota[`${a}_1999-01-01`] = { count: TRIAL_DAILY_EMAIL_LIMIT };
    await capture({ companyId: a, message: "hola", contact: { email: "d@example.com" } });
    assert.strictEqual(resendCalls.length, 1, "a sigue bloqueada hoy");
  });
  test("empresa que NO es trial no tiene tope ni toca el contador", async () => {
    store.leadflow_email_quota = { [`abc-roofing_${day()}`]: { count: 9999 } };
    await capture({ companyId: "abc-roofing", message: "hola", contact: { email: "e@example.com" } });
    assert.strictEqual(resendCalls.length, 1);
    assert.strictEqual(store.leadflow_email_quota[`abc-roofing_${day()}`].count, 9999);
  });
  test("empresa desactivada (trial vencido) → 404, sin leads", async () => {
    const companyId = await trialCompany();
    store.leadflow_companies[companyId].isActive = false;
    const r = await capture({ companyId, message: "hola", contact: { email: "f@example.com" } });
    assert.strictEqual(r.code, 404);
    assert.strictEqual(Object.keys(store.leadflow_leads || {}).length, 0);
  });
});

describe("follow-ups", () => {
  const hoursAgo = (h) => new Ts(Date.now() - h * 3600e3);
  function seedLead(id, companyId) {
    store.leadflow_leads = store.leadflow_leads || {};
    store.leadflow_leads[id] = {
      companyId, status: "BOOKING_SENT", contact: { email: `${id}@example.com` }, message: "techo",
      bookingLinkSent: "https://cal.com/x", autoReply: { generatedAt: hoursAgo(25) },
      followUp: { attempts: 0, stopped: false }, aiUsage: [],
    };
  }
  test("empresa inactiva → se detiene con company_inactive, sin email ni IA", async () => {
    store.leadflow_companies["abc-roofing"].isActive = false;
    seedLead("l1", "abc-roofing");
    await leadflowFollowUpScheduler();
    assert.strictEqual(store.leadflow_leads.l1.followUp.stopped, true);
    assert.strictEqual(store.leadflow_leads.l1.followUp.stopReason, "company_inactive");
    assert.strictEqual(resendCalls.length, 0);
    assert.strictEqual(replyCalls.length, 0);
  });
  test("empresa de trial con cuota agotada → intento registrado, email bloqueado", async () => {
    const companyId = (await signup({ ...validForm(), bookingLink: "https://cal.com/x" })).body.companyId;
    store.leadflow_email_quota = { [`${companyId}_${day()}`]: { count: TRIAL_DAILY_EMAIL_LIMIT } };
    seedLead("l2", companyId);
    await leadflowFollowUpScheduler();
    const f = store.leadflow_leads.l2.followUp;
    assert.strictEqual(f.attempts, 1);
    assert.strictEqual(f.lastMessage.sentAt, null);
    assert.strictEqual(f.lastMessage.sendError, "daily_email_quota_exceeded");
    assert.strictEqual(resendCalls.length, 0);
  });
  test("empresa normal activa → envía como antes", async () => {
    seedLead("l3", "abc-roofing");
    await leadflowFollowUpScheduler();
    assert.strictEqual(resendCalls.length, 1);
    assert.ok(store.leadflow_leads.l3.followUp.lastMessage.sentAt instanceof Ts);
  });
});

describe("leadflowExpireTrials", () => {
  test("solo desactiva trials vencidos y activos", async () => {
    const past = new Ts(Date.now() - 3600e3), future = new Ts(Date.now() + 864e5);
    Object.assign(store.leadflow_companies, {
      vencido: { isTrial: true, isActive: true, trialEndsAt: past },
      vigente: { isTrial: true, isActive: true, trialEndsAt: future },
      pagado: { isTrial: false, isActive: true, trialEndsAt: past },
      yaInactivo: { isTrial: true, isActive: false, trialEndsAt: past },
    });
    await leadflowExpireTrials();
    const c = store.leadflow_companies;
    assert.strictEqual(c.vencido.isActive, false);
    assert.ok(c.vencido.trialExpiredAt instanceof Ts);
    assert.strictEqual(c.vigente.isActive, true);
    assert.strictEqual(c.pagado.isActive, true, "un cliente que ya pagó (isTrial:false) no se toca");
    assert.ok(!("trialExpiredAt" in c.yaInactivo), "no se reescribe uno ya inactivo");
    assert.strictEqual(c["abc-roofing"].isActive, true);
  });
});
