// Pruebas de firestore.rules contra el emulador (proyecto demo-*, nunca
// producción). Datos sintéticos con la misma forma que los reales — ningún
// dato real de clientes.
//
//   cd tests/firestore-rules && npm install && npm test
import { test, before, after, beforeEach, describe } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, serverTimestamp,
} from "firebase/firestore";

const RULES = readFileSync(process.env.RULES_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../firestore.rules"), "utf8");

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-veloiapp", firestore: { rules: RULES } });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Dos negocios (A = el "Selective Crew" de la prueba, B = otro cliente),
    // más bots sin dueño como los de demo/test que hay hoy.
    await setDoc(doc(db, "clients/clientA"), { email: "owner@a.com", businessName: "Negocio A", isTrial: false, isActive: true });
    await setDoc(doc(db, "clients/clientB"), { email: "owner@b.com", businessName: "Negocio B", isTrial: true, isActive: true });
    await setDoc(doc(db, "bots/botA"), { botName: "Negocio A", whatsappPhoneId: "phoneA", isActive: true, allowedUsers: ["owner@a.com"] });
    await setDoc(doc(db, "bots/botB"), { botName: "Negocio B", whatsappPhoneId: "phoneB", isActive: true, allowedUsers: ["owner@b.com"] });
    await setDoc(doc(db, "bots/botDemo"), { botName: "Demo", whatsappPhoneId: "phoneDemo", isActive: true, allowedUsers: [] });
    await setDoc(doc(db, "bots/botLegacy"), { botName: "Legacy", isActive: false }); // sin allowedUsers
    await setDoc(doc(db, "conversations/cA"), { botId: "botA", phoneId: "phoneA", userMessage: "hola", botReply: "hola!" });
    await setDoc(doc(db, "conversations/cB"), { botId: "botB", phoneId: "phoneB", userMessage: "hola", botReply: "hola!" });
    await setDoc(doc(db, "conversations/cNoBotId"), { phoneId: "phoneA", userMessage: "viejo", botReply: "sin botId" });
    await setDoc(doc(db, "conversations/cGhost"), { botId: "botQueNoExiste", phoneId: "phoneX" });
    await setDoc(doc(db, "leads/lA"), { botId: "botA", phoneId: "phoneA", stage: "nuevo", messageCount: 1 });
    await setDoc(doc(db, "leads/lB"), { botId: "botB", phoneId: "phoneB", stage: "nuevo", messageCount: 1 });
    await setDoc(doc(db, "leads/lNoBotId"), { phoneId: "phoneA", stage: "nuevo" });
    await setDoc(doc(db, "leadflow_companies/acme"), { name: "Acme", allowedUsers: ["owner@a.com"] });
  });
});

const user = (email, verified = true) => env.authenticatedContext(email, { email, email_verified: verified }).firestore();
const ownerA = () => user("owner@a.com");
const ownerB = () => user("owner@b.com");
const admin = () => user("hola@veloiapp.com");
const stranger = () => user("random@gmail.com");
const anon = () => env.unauthenticatedContext().firestore();

// Las mismas consultas que hace dashboard/client.html
const qMyBot = (db, email) => query(collection(db, "bots"), where("allowedUsers", "array-contains", email));
const qConvs = (db, botId) => query(collection(db, "conversations"), where("botId", "==", botId));
const qLeads = (db, botId) => query(collection(db, "leads"), where("botId", "==", botId));

describe("dueño (owner@a.com)", () => {
  test("encuentra su bot con la consulta de client.html", async () => {
    const snap = await assertSucceeds(getDocs(qMyBot(ownerA(), "owner@a.com")));
    if (snap.size !== 1 || snap.docs[0].id !== "botA") throw new Error(`esperaba solo botA, llegó ${snap.docs.map((d) => d.id)}`);
  });
  test("lee sus conversaciones y leads por botId", async () => {
    const convs = await assertSucceeds(getDocs(qConvs(ownerA(), "botA")));
    const leads = await assertSucceeds(getDocs(qLeads(ownerA(), "botA")));
    if (convs.size !== 1 || leads.size !== 1) throw new Error(`convs=${convs.size} leads=${leads.size}`);
  });
  test("lee su documento de clients (búsqueda por email)", async () => {
    await assertSucceeds(getDocs(query(collection(ownerA(), "clients"), where("email", "==", "owner@a.com"))));
  });
  test("mueve su lead en el embudo (solo stage)", async () => {
    await assertSucceeds(updateDoc(doc(ownerA(), "leads/lA"), { stage: "calificado" }));
  });
  test("NO puede cambiar otros campos de su lead", async () => {
    await assertFails(updateDoc(doc(ownerA(), "leads/lA"), { stage: "calificado", botId: "botB" }));
    await assertFails(updateDoc(doc(ownerA(), "leads/lA"), { messageCount: 999 }));
  });
  test("borra su propio lead", async () => {
    await assertSucceeds(deleteDoc(doc(ownerA(), "leads/lA")));
  });
  test("NO puede editar su bot ni crear conversaciones/leads", async () => {
    await assertFails(updateDoc(doc(ownerA(), "bots/botA"), { systemPrompt: "x" }));
    await assertFails(updateDoc(doc(ownerA(), "bots/botA"), { allowedUsers: ["owner@a.com", "otro@x.com"] }));
    await assertFails(addDoc(collection(ownerA(), "conversations"), { botId: "botA" }));
    await assertFails(addDoc(collection(ownerA(), "leads"), { botId: "botA" }));
  });
});

describe("aislamiento: otro cliente (owner@b.com) contra datos de A", () => {
  test("no lee el bot de A ni directo ni por consulta", async () => {
    await assertFails(getDoc(doc(ownerB(), "bots/botA")));
    await assertFails(getDocs(qMyBot(ownerB(), "owner@a.com")));
    await assertFails(getDocs(collection(ownerB(), "bots")));
  });
  test("no lee conversaciones ni leads de A", async () => {
    await assertFails(getDoc(doc(ownerB(), "conversations/cA")));
    await assertFails(getDoc(doc(ownerB(), "leads/lA")));
    await assertFails(getDocs(qConvs(ownerB(), "botA")));
    await assertFails(getDocs(qLeads(ownerB(), "botA")));
  });
  test("la consulta vieja por phoneId queda denegada (también para el dueño)", async () => {
    await assertFails(getDocs(query(collection(ownerB(), "conversations"), where("phoneId", "==", "phoneA"))));
    await assertFails(getDocs(query(collection(ownerA(), "conversations"), where("phoneId", "==", "phoneA"))));
    await assertFails(getDocs(query(collection(ownerA(), "leads"), where("phoneId", "==", "phoneA"))));
  });
  test("no lista colecciones completas", async () => {
    await assertFails(getDocs(collection(ownerB(), "conversations")));
    await assertFails(getDocs(collection(ownerB(), "leads")));
    await assertFails(getDocs(collection(ownerB(), "clients")));
  });
  test("no edita ni borra leads de A", async () => {
    await assertFails(updateDoc(doc(ownerB(), "leads/lA"), { stage: "perdido" }));
    await assertFails(deleteDoc(doc(ownerB(), "leads/lA")));
  });
  test("no lee el documento clients de A", async () => {
    await assertFails(getDoc(doc(ownerB(), "clients/clientA")));
  });
});

describe("usuarios sin acceso", () => {
  test("usuario verificado sin bot: ve cero bots, nada más", async () => {
    const snap = await assertSucceeds(getDocs(qMyBot(stranger(), "random@gmail.com")));
    if (snap.size !== 0) throw new Error("no debería ver bots");
    await assertFails(getDoc(doc(stranger(), "conversations/cA")));
    await assertFails(getDoc(doc(stranger(), "leads/lA")));
  });
  test("token con el email del dueño pero SIN verificar: denegado", async () => {
    const fake = user("owner@a.com", false);
    await assertFails(getDoc(doc(fake, "bots/botA")));
    await assertFails(getDocs(qConvs(fake, "botA")));
    await assertFails(updateDoc(doc(fake, "leads/lA"), { stage: "perdido" }));
    await assertFails(getDoc(doc(fake, "clients/clientA")));
  });
  test("email de admin SIN verificar: no es admin", async () => {
    await assertFails(getDocs(collection(user("hola@veloiapp.com", false), "bots")));
  });
  test("sin sesión: todo denegado", async () => {
    await assertFails(getDoc(doc(anon(), "bots/botA")));
    await assertFails(getDoc(doc(anon(), "conversations/cA")));
    await assertFails(getDoc(doc(anon(), "leads/lA")));
    await assertFails(getDocs(collection(anon(), "clients")));
  });
  test("docs sin botId o con bot inexistente: nadie salvo admin", async () => {
    await assertFails(getDoc(doc(ownerA(), "conversations/cNoBotId")));
    await assertFails(getDoc(doc(ownerA(), "conversations/cGhost")));
    await assertFails(getDoc(doc(ownerA(), "leads/lNoBotId")));
  });
  test("bots sin dueño (allowedUsers vacío o ausente): nadie salvo admin", async () => {
    await assertFails(getDoc(doc(ownerA(), "bots/botDemo")));
    await assertFails(getDoc(doc(ownerA(), "bots/botLegacy")));
  });
});

describe("creación desde el navegador (antes pública para trials)", () => {
  test("crear client o bot sin ser admin: denegado, aunque sea isTrial", async () => {
    await assertFails(addDoc(collection(anon(), "clients"), { isTrial: true, email: "x@y.com" }));
    await assertFails(addDoc(collection(stranger(), "clients"), { isTrial: true, email: "random@gmail.com" }));
    await assertFails(addDoc(collection(anon(), "bots"), { isTrial: true, isActive: false }));
    // el ataque concreto: bot activo con el phoneId de otro negocio
    await assertFails(addDoc(collection(stranger(), "bots"), { isTrial: true, isActive: true, whatsappPhoneId: "phoneA", allowedUsers: ["random@gmail.com"] }));
  });
});

describe("admin", () => {
  test("lee todo, incluidos docs sin botId y bots sin dueño", async () => {
    const db = admin();
    for (const col of ["clients", "bots", "conversations", "leads"]) await assertSucceeds(getDocs(collection(db, col)));
    await assertSucceeds(getDoc(doc(db, "conversations/cNoBotId")));
    await assertSucceeds(getDoc(doc(db, "bots/botLegacy")));
  });
  test("crea clientes y bots (flujo de admin.html) y edita bots", async () => {
    const db = admin();
    await assertSucceeds(addDoc(collection(db, "clients"), { businessName: "Nuevo", email: "n@n.com" }));
    await assertSucceeds(addDoc(collection(db, "bots"), { botName: "Nuevo", allowedUsers: ["n@n.com"] }));
    await assertSucceeds(updateDoc(doc(db, "bots/botA"), { isActive: false }));
    await assertSucceeds(updateDoc(doc(db, "leads/lA"), { messageCount: 2 }));
  });
});

describe("regresión: otras colecciones sin cambios", () => {
  test("formularios públicos siguen funcionando", async () => {
    await assertSucceeds(addDoc(collection(anon(), "leads_landing"), { name: "x" }));
    await assertSucceeds(addDoc(collection(anon(), "onboarding_submissions"), { name: "x" }));
    await assertFails(getDocs(collection(anon(), "leads_landing")));
  });
  test("LeadFlow: miembro lee su empresa, otro no", async () => {
    await assertSucceeds(getDoc(doc(ownerA(), "leadflow_companies/acme")));
    await assertFails(getDoc(doc(ownerB(), "leadflow_companies/acme")));
  });
  test("colección no listada: denegada", async () => {
    await assertFails(getDoc(doc(admin(), "otra_coleccion/x")));
  });
});

// Las mismas consultas que hace dashboard/leadflow.html al iniciar sesión.
// La primera (array-contains) fallaba con la regla anterior, que autorizaba
// vía get() por el ID del documento — el test por getDoc de arriba no lo
// detectaba.
describe("LeadFlow: consultas exactas de leadflow.html", () => {
  const qMyCompanies = (db, email) => query(collection(db, "leadflow_companies"), where("allowedUsers", "array-contains", email));
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "leadflow_companies/otra"), { name: "Otra", allowedUsers: ["owner@b.com"] });
      await setDoc(doc(db, "leadflow_leads/lf1"), { companyId: "acme", status: "NEW" });
      await setDoc(doc(db, "leadflow_handoffs/hf1"), { companyId: "acme", status: "OPEN" });
    });
  });

  test("miembro (no admin): lista sus empresas con array-contains y recibe solo la suya", async () => {
    const snap = await assertSucceeds(getDocs(qMyCompanies(ownerA(), "owner@a.com")));
    if (snap.size !== 1 || snap.docs[0].id !== "acme") throw new Error(`esperaba solo acme, llegó ${snap.docs.map((d) => d.id)}`);
  });
  test("miembro: luego carga leads y handoffs de su empresa por companyId", async () => {
    await assertSucceeds(getDocs(query(collection(ownerA(), "leadflow_leads"), where("companyId", "==", "acme"))));
    await assertSucceeds(getDocs(query(collection(ownerA(), "leadflow_handoffs"), where("companyId", "==", "acme"))));
  });
  test("admin: getDocs de toda la colección", async () => {
    const snap = await assertSucceeds(getDocs(collection(admin(), "leadflow_companies")));
    if (snap.size !== 2) throw new Error(`esperaba 2 empresas, llegaron ${snap.size}`);
  });
  test("aislamiento: array-contains con email ajeno, colección completa y leads ajenos, denegados", async () => {
    await assertFails(getDocs(qMyCompanies(ownerA(), "owner@b.com")));
    await assertFails(getDocs(collection(ownerA(), "leadflow_companies")));
    await assertFails(getDoc(doc(ownerA(), "leadflow_companies/otra")));
    await assertFails(getDocs(query(collection(ownerB(), "leadflow_leads"), where("companyId", "==", "acme"))));
  });
  test("email sin verificar o sin sesión: denegado", async () => {
    await assertFails(getDocs(qMyCompanies(user("owner@a.com", false), "owner@a.com")));
    await assertFails(getDocs(qMyCompanies(anon(), "owner@a.com")));
  });
  test("nadie escribe leadflow_companies desde el navegador salvo admin", async () => {
    await assertFails(setDoc(doc(ownerA(), "leadflow_companies/acme"), { name: "Hack", allowedUsers: ["owner@a.com", "x@x.com"] }));
    await assertFails(setDoc(doc(ownerA(), "leadflow_companies/nueva"), { name: "Nueva", allowedUsers: ["owner@a.com"] }));
  });
});

// B3 (Production Readiness Audit): un miembro de A podía mover sus leads y
// handoffs a B (inyectando datos en el dashboard de B) y reescribir
// cualquier campo de sus leads. Ahora companyId es inmutable y solo se
// permiten las escrituras exactas que hace leadflow.html.
describe("LeadFlow B3: aislamiento de escritura y lectura entre empresas", () => {
  const qEvents = (db, leadId, companyId) => query(collection(db, "leadflow_lead_events"),
    where("leadId", "==", leadId), where("companyId", "==", companyId));

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "leadflow_companies/otra"), { name: "Otra", allowedUsers: ["owner@b.com"] });
      await setDoc(doc(db, "leadflow_leads/lfA"), {
        companyId: "acme", status: "BOOKING_SENT", contact: { email: "lead@x.com" }, message: "hola",
        analysis: { qualification: "qualified" }, score: { adjusted: 80 }, autoReply: { text: "hi" },
        bookingLinkSent: "https://cal.example/x", followUp: { attempts: 0, stopped: false }, lastHandoffId: null,
      });
      await setDoc(doc(db, "leadflow_leads/lfB"), { companyId: "otra", status: "NEW", contact: { email: "b@x.com" } });
      await setDoc(doc(db, "leadflow_handoffs/hfA"), {
        companyId: "acme", leadId: "lfA", status: "OPEN", reason: "r", triggeredBy: "AI_LOW_CONFIDENCE",
        snapshot: { message: "hola" }, resolvedBy: null, resolvedAt: null,
      });
      await setDoc(doc(db, "leadflow_handoffs/hfB"), { companyId: "otra", leadId: "lfB", status: "OPEN" });
      await setDoc(doc(db, "leadflow_lead_events/evA"), { companyId: "acme", leadId: "lfA", type: "STATUS_CHANGE" });
      await setDoc(doc(db, "leadflow_lead_events/evB"), { companyId: "otra", leadId: "lfB", type: "STATUS_CHANGE" });
    });
  });

  test("A no puede cambiar el companyId de su lead a B (ni sola ni junto a status)", async () => {
    await assertFails(updateDoc(doc(ownerA(), "leadflow_leads/lfA"), { companyId: "otra" }));
    await assertFails(updateDoc(doc(ownerA(), "leadflow_leads/lfA"), { companyId: "otra", status: "NEW", updatedAt: serverTimestamp() }));
  });
  test("A no puede cambiar el companyId de su handoff a B", async () => {
    await assertFails(updateDoc(doc(ownerA(), "leadflow_handoffs/hfA"), { companyId: "otra" }));
    await assertFails(updateDoc(doc(ownerA(), "leadflow_handoffs/hfA"), { companyId: "otra", status: "ACKNOWLEDGED" }));
  });
  test("ni el admin mueve docs de empresa desde el navegador", async () => {
    await assertFails(updateDoc(doc(admin(), "leadflow_leads/lfA"), { companyId: "otra" }));
    await assertFails(updateDoc(doc(admin(), "leadflow_handoffs/hfA"), { companyId: "otra" }));
  });
  test("A no puede alterar campos internos protegidos del lead", async () => {
    const protectedUpdates = [
      { "contact.email": "attacker@evil.test" }, { contact: { email: "attacker@evil.test" } },
      { analysis: { qualification: "unqualified" } }, { score: { adjusted: 1 } },
      { autoReply: { text: "<b>x</b>" } }, { bookingLinkSent: "https://evil.test" },
      { "followUp.attempts": 5 }, { "followUp.stopped": true }, { lastHandoffId: "x" }, { message: "otro" }, { dedupeKey: "x" },
      { status: "NEW", updatedAt: serverTimestamp(), "contact.email": "attacker@evil.test" },
    ];
    for (const data of protectedUpdates) {
      await assertFails(updateDoc(doc(ownerA(), "leadflow_leads/lfA"), data));
    }
  });
  test("A no puede alterar campos protegidos del handoff", async () => {
    for (const data of [{ reason: "x" }, { triggeredBy: "x" }, { snapshot: {} }, { leadId: "lfB" }, { status: "OPEN" }, { status: "HACKED" }]) {
      await assertFails(updateDoc(doc(ownerA(), "leadflow_handoffs/hfA"), data));
    }
    // resolvedBy tiene que ser su propio email; resolvedAt, la hora del servidor.
    await assertFails(updateDoc(doc(ownerA(), "leadflow_handoffs/hfA"), { status: "RESOLVED", resolvedBy: "otro@x.com", resolvedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(ownerA(), "leadflow_handoffs/hfA"), { status: "RESOLVED", resolvedBy: "owner@a.com", resolvedAt: new Date(0) }));
  });
  test("A puede hacer las escrituras legítimas de leadflow.html", async () => {
    // Mover la tarjeta del embudo.
    await assertSucceeds(updateDoc(doc(ownerA(), "leadflow_leads/lfA"), { status: "CLOSED", updatedAt: serverTimestamp() }));
    // Reconocer y luego resolver el handoff.
    await assertSucceeds(updateDoc(doc(ownerA(), "leadflow_handoffs/hfA"), { status: "ACKNOWLEDGED" }));
    await assertSucceeds(updateDoc(doc(ownerA(), "leadflow_handoffs/hfA"), { status: "RESOLVED", resolvedBy: "owner@a.com", resolvedAt: serverTimestamp() }));
  });
  test("status fuera de los valores del embudo o updatedAt manipulado: denegado", async () => {
    await assertFails(updateDoc(doc(ownerA(), "leadflow_leads/lfA"), { status: "HACKED", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(ownerA(), "leadflow_leads/lfA"), { status: "CLOSED", updatedAt: new Date(0) }));
  });
  test("A no puede escribir leads ni handoffs de B", async () => {
    await assertFails(updateDoc(doc(ownerA(), "leadflow_leads/lfB"), { status: "CLOSED", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(ownerA(), "leadflow_handoffs/hfB"), { status: "ACKNOWLEDGED" }));
  });
  test("A lee los eventos de sus leads con la consulta de leadflow.html (leadId + companyId)", async () => {
    const snap = await assertSucceeds(getDocs(qEvents(ownerA(), "lfA", "acme")));
    if (snap.size !== 1 || snap.docs[0].id !== "evA") throw new Error(`esperaba solo evA, llegó ${snap.docs.map((d) => d.id)}`);
  });
  test("A no puede leer eventos de B", async () => {
    await assertFails(getDocs(qEvents(ownerA(), "lfB", "otra")));
    await assertFails(getDocs(query(collection(ownerA(), "leadflow_lead_events"), where("companyId", "==", "otra"))));
    await assertFails(getDoc(doc(ownerA(), "leadflow_lead_events/evB")));
    // Sin filtro de empresa la consulta no se puede probar: se deniega.
    await assertFails(getDocs(query(collection(ownerA(), "leadflow_lead_events"), where("leadId", "==", "lfB"))));
  });
  test("email no verificado no obtiene membership (leads, handoffs, eventos, escrituras)", async () => {
    const unverifiedA = user("owner@a.com", false);
    await assertFails(getDoc(doc(unverifiedA, "leadflow_leads/lfA")));
    await assertFails(getDocs(query(collection(unverifiedA, "leadflow_leads"), where("companyId", "==", "acme"))));
    await assertFails(getDocs(query(collection(unverifiedA, "leadflow_handoffs"), where("companyId", "==", "acme"))));
    await assertFails(getDocs(qEvents(unverifiedA, "lfA", "acme")));
    await assertFails(updateDoc(doc(unverifiedA, "leadflow_leads/lfA"), { status: "CLOSED", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(unverifiedA, "leadflow_handoffs/hfA"), { status: "ACKNOWLEDGED" }));
  });
  test("B4: leadflow_bookings (idempotencia del webhook de Cal.com) es solo del backend", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "leadflow_bookings/bkg1"), { leadId: "lfA", companyId: "acme", outcome: "applied" });
    });
    await assertFails(getDoc(doc(ownerA(), "leadflow_bookings/bkg1")));
    await assertFails(getDocs(query(collection(ownerA(), "leadflow_bookings"), where("companyId", "==", "acme"))));
    await assertFails(setDoc(doc(ownerA(), "leadflow_bookings/bkg2"), { leadId: "lfA", companyId: "acme" }));
    await assertFails(setDoc(doc(anon(), "leadflow_bookings/bkg3"), { leadId: "lfA", companyId: "acme" }));
  });
  test("admin conserva sus operaciones del dashboard", async () => {
    await assertSucceeds(getDocs(qEvents(admin(), "lfB", "otra")));
    await assertSucceeds(updateDoc(doc(admin(), "leadflow_leads/lfB"), { status: "CLOSED", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(admin(), "leadflow_handoffs/hfB"), { status: "RESOLVED", resolvedBy: "hola@veloiapp.com", resolvedAt: serverTimestamp() }));
  });
});

// Fase 1 de seguridad del email outbound: el permiso de envío
// (outboundEmail) y los campos de control del trial solo los cambia un admin
// o el backend. firestore.rules ya lo garantiza (leadflow_companies: write
// solo admin; colecciones del servidor: denegadas por la regla final) — estos
// tests lo fijan.
describe("LeadFlow Fase 1: permiso de email outbound y campos protegidos de la empresa", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "leadflow_companies/trialA"), {
        name: "Trial A", allowedUsers: ["owner@a.com"], contactEmail: "owner@a.com",
        isTrial: true, isActive: true, trialEndsAt: new Date(Date.now() + 864e5),
        outboundEmail: { status: "PENDING_REVIEW" }, bookingLink: "https://cal.com/a/30min",
      });
      await setDoc(doc(db, "leadflow_companies/otra"), { name: "Otra", allowedUsers: ["owner@b.com"], outboundEmail: { status: "ENABLED" } });
      await setDoc(doc(db, "leadflow_email_quota/trialA_2026-09-24"), { companyId: "trialA", count: 50 });
      await setDoc(doc(db, "leadflow_rate_limits/capture_trialA_2026-09-24T10"), { companyId: "trialA", count: 20 });
    });
  });

  test("31. el dueño NO puede cambiar outboundEmail.status (ni aprobarse ni reemplazar el objeto)", async () => {
    await assertFails(updateDoc(doc(ownerA(), "leadflow_companies/trialA"), { "outboundEmail.status": "ENABLED" }));
    await assertFails(updateDoc(doc(ownerA(), "leadflow_companies/trialA"), { outboundEmail: { status: "ENABLED", enabledAt: serverTimestamp() } }));
    await assertFails(setDoc(doc(ownerA(), "leadflow_companies/trialA"), { outboundEmail: { status: "ENABLED" } }, { merge: true }));
  });
  test("32. el dueño NO puede modificar campos protegidos de su empresa", async () => {
    const updates = [
      { isTrial: false }, { isActive: true }, { demoMode: false }, { demoMode: true },
      { trialEndsAt: new Date(Date.now() + 365 * 864e5) }, { bookingLink: "https://evil.com/cal.com" },
      { contactEmail: "attacker@evil.test" }, { allowedUsers: ["owner@a.com", "x@evil.test"] }, { name: "PayPal" },
    ];
    for (const data of updates) {
      await assertFails(updateDoc(doc(ownerA(), "leadflow_companies/trialA"), data));
    }
  });
  test("el dueño NO puede escribir cuotas, rate limits ni configuración del servidor", async () => {
    await assertFails(updateDoc(doc(ownerA(), "leadflow_email_quota/trialA_2026-09-24"), { count: 0 }));
    await assertFails(setDoc(doc(ownerA(), "leadflow_email_quota/trialA_2026-09-25"), { companyId: "trialA", count: 0 }));
    await assertFails(deleteDoc(doc(ownerA(), "leadflow_rate_limits/capture_trialA_2026-09-24T10")));
    await assertFails(setDoc(doc(ownerA(), "leadflow_config/email"), { killSwitch: false }));
    await assertFails(getDoc(doc(ownerA(), "leadflow_email_quota/trialA_2026-09-24")), "tampoco las lee");
  });
  test("33. el admin sí puede cambiar outboundEmail (PENDING_REVIEW → ENABLED → SUSPENDED)", async () => {
    await assertSucceeds(updateDoc(doc(admin(), "leadflow_companies/trialA"), {
      "outboundEmail.status": "ENABLED", "outboundEmail.enabledAt": serverTimestamp(), "outboundEmail.updatedBy": "hola@veloiapp.com",
    }));
    await assertSucceeds(updateDoc(doc(admin(), "leadflow_companies/trialA"), { "outboundEmail.status": "SUSPENDED" }));
  });
  test("34. aislamiento intacto: el dueño lee su empresa (con su estado) pero no la de otro", async () => {
    const snap = await assertSucceeds(getDoc(doc(ownerA(), "leadflow_companies/trialA")));
    assert.strictEqual(snap.data().outboundEmail.status, "PENDING_REVIEW");
    await assertFails(getDoc(doc(ownerA(), "leadflow_companies/otra")));
    await assertFails(updateDoc(doc(ownerA(), "leadflow_companies/otra"), { "outboundEmail.status": "SUSPENDED" }));
    await assertFails(updateDoc(doc(ownerB(), "leadflow_companies/trialA"), { "outboundEmail.status": "ENABLED" }));
    await assertFails(getDoc(doc(stranger(), "leadflow_companies/trialA")));
    await assertFails(updateDoc(doc(anon(), "leadflow_companies/trialA"), { "outboundEmail.status": "ENABLED" }));
  });
});

// Auditoría de acciones de admin (leadflow_admin_events): la escribe solo el
// backend (leadflowSetOutboundEmailStatus, Admin SDK). Desde el navegador
// nadie la lee ni la escribe — ni el dueño ni el admin — por la regla final.
describe("LeadFlow: leadflow_admin_events es solo del backend", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "leadflow_admin_events/ev1"), {
        type: "OUTBOUND_EMAIL_STATUS_CHANGED", companyId: "acme", from: "PENDING_REVIEW", to: "ENABLED", actor: "hola@veloiapp.com",
      });
    });
  });
  test("nadie la lee ni la escribe desde el navegador", async () => {
    for (const db of [ownerA(), admin(), stranger(), anon()]) {
      await assertFails(getDoc(doc(db, "leadflow_admin_events/ev1")));
      await assertFails(setDoc(doc(db, "leadflow_admin_events/ev2"), { type: "OUTBOUND_EMAIL_STATUS_CHANGED", companyId: "acme" }));
      await assertFails(updateDoc(doc(db, "leadflow_admin_events/ev1"), { to: "SUSPENDED" }));
    }
  });
});

// Revisión humana: mientras un lead está en HUMAN_REVIEW (o con la marca
// humanControl.active que solo escribe el backend) el navegador de un miembro
// no cambia su status — la salida es leadflowResumeAutomation, con
// autorización y auditoría en el servidor. Tampoco puede apagar humanControl.
describe("LeadFlow: status bloqueado durante la revisión humana", () => {
  const seedLead = (id, data) => env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `leadflow_leads/${id}`), { companyId: "acme", contact: { email: "lead@x.com" }, ...data });
  });
  const move = (db, id, status) => updateDoc(doc(db, `leadflow_leads/${id}`), { status, updatedAt: serverTimestamp() });

  beforeEach(async () => {
    await seedLead("normal", { status: "CONTACTED" });
    await seedLead("review", { status: "HUMAN_REVIEW", humanControl: { active: true } });
    await seedLead("legacyReview", { status: "HUMAN_REVIEW" }); // lead anterior a humanControl
    await seedLead("flagOnly", { status: "CONTACTED", humanControl: { active: true } });
    await seedLead("resumed", { status: "CONTACTED", humanControl: { active: false } });
  });

  test("1. fuera de revisión humana el miembro sigue moviendo la tarjeta (también HACIA HUMAN_REVIEW)", async () => {
    await assertSucceeds(move(ownerA(), "normal", "QUALIFIED"));
    await assertSucceeds(move(ownerA(), "normal", "HUMAN_REVIEW"));
    await assertSucceeds(move(ownerA(), "resumed", "NURTURE"));
  });

  for (const target of ["CONTACTED", "QUALIFIED", "NURTURE", "CLOSED", "BOOKING_SENT", "APPOINTMENT_BOOKED", "NEW"]) {
    test(`2-5. HUMAN_REVIEW → ${target}: denegado al miembro`, async () => {
      await assertFails(move(ownerA(), "review", target));
    });
  }

  test("6. el miembro no puede apagar humanControl (ni solo, ni junto al status, ni reemplazando el mapa)", async () => {
    for (const id of ["review", "flagOnly"]) {
      await assertFails(updateDoc(doc(ownerA(), `leadflow_leads/${id}`), { "humanControl.active": false }));
      await assertFails(updateDoc(doc(ownerA(), `leadflow_leads/${id}`), { humanControl: { active: false } }));
      await assertFails(updateDoc(doc(ownerA(), `leadflow_leads/${id}`), { humanControl: null }));
      await assertFails(updateDoc(doc(ownerA(), `leadflow_leads/${id}`), { "humanControl.active": false, status: "CONTACTED", updatedAt: serverTimestamp() }));
    }
    // Tampoco puede prenderla ni inventarla en un lead normal.
    await assertFails(updateDoc(doc(ownerA(), "leadflow_leads/normal"), { "humanControl.active": true }));
  });

  test("7. status CONTACTED con humanControl.active → el miembro no cambia el status", async () => {
    for (const target of ["QUALIFIED", "CLOSED", "BOOKING_SENT", "HUMAN_REVIEW"]) {
      await assertFails(move(ownerA(), "flagOnly", target));
    }
  });

  test("8. lead antiguo en HUMAN_REVIEW sin humanControl sigue protegido", async () => {
    for (const target of ["CONTACTED", "CLOSED", "BOOKING_SENT"]) {
      await assertFails(move(ownerA(), "legacyReview", target));
    }
  });

  test("9. durante la revisión, la única otra escritura que ya permitían las reglas (updatedAt del servidor) sigue permitida; nada más", async () => {
    await assertSucceeds(updateDoc(doc(ownerA(), "leadflow_leads/review"), { updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(ownerA(), "leadflow_leads/legacyReview"), { updatedAt: serverTimestamp() }));
    // Reescribir el mismo status no es un cambio de status (no está en affectedKeys).
    await assertSucceeds(move(ownerA(), "review", "HUMAN_REVIEW"));
    await assertFails(updateDoc(doc(ownerA(), "leadflow_leads/review"), { updatedAt: new Date(0) }));
    await assertFails(updateDoc(doc(ownerA(), "leadflow_leads/review"), { "contact.email": "x@evil.test" }));
  });

  test("otra empresa ni un email sin verificar pueden tocarlo (aislamiento intacto)", async () => {
    await assertFails(move(ownerB(), "review", "CONTACTED"));
    await assertFails(move(ownerB(), "normal", "CLOSED"));
    await assertFails(move(user("owner@a.com", false), "normal", "CLOSED"));
    await assertFails(move(anon(), "review", "CONTACTED"));
  });

  test("10. backend y admin sin cambios: el Admin SDK (sin reglas) aplica la reanudación; el admin conserva su override", async () => {
    // Lo que escribe resumeAutomation (Admin SDK: no pasa por las reglas).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "leadflow_leads/review"), {
        status: "CONTACTED", humanControl: { active: false, resumedBy: "owner@a.com" },
      });
    });
    // Ya fuera de revisión: el miembro vuelve a mover la tarjeta.
    await assertSucceeds(move(ownerA(), "review", "QUALIFIED"));
    // El admin de LeadFlow mantiene su override desde el navegador (regla existente).
    await assertSucceeds(move(admin(), "legacyReview", "CONTACTED"));
  });
});
