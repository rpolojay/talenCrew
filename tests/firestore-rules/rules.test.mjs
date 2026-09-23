// Pruebas de firestore.rules contra el emulador (proyecto demo-*, nunca
// producción). Datos sintéticos con la misma forma que los reales — ningún
// dato real de clientes.
//
//   cd tests/firestore-rules && npm install && npm test
import { test, before, after, beforeEach, describe } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where,
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
