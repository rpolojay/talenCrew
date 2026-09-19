const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const cors = require("cors")({ origin: true });
const { GoogleGenAI } = require("@google/genai");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const WHATSAPP_VERIFY_TOKEN = defineSecret("WHATSAPP_VERIFY_TOKEN");
const WHATSAPP_ACCESS_TOKEN = defineSecret("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_APP_SECRET = defineSecret("WHATSAPP_APP_SECRET");

const WHATSAPP_GRAPH_API_VERSION = "v21.0";

// Valida el header X-Hub-Signature-256 que Meta manda en cada POST del
// webhook: HMAC-SHA256 del body CRUDO (req.rawBody, no el JSON re-serializado
// — Firebase Functions lo conserva exactamente para este uso) firmado con el
// App Secret de la app de Meta. Comparación en tiempo constante para no
// filtrar información por timing.
function isValidMetaSignature(req, appSecret) {
  const signatureHeader = req.get("x-hub-signature-256");
  if (!signatureHeader || !signatureHeader.startsWith("sha256=") || !req.rawBody) {
    return false;
  }

  const expectedHex = signatureHeader.slice("sha256=".length);
  const computedHex = crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex");

  const expectedBuffer = Buffer.from(expectedHex, "hex");
  const computedBuffer = Buffer.from(computedHex, "hex");
  if (expectedBuffer.length !== computedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, computedBuffer);
}

exports.liveDemoAgent = onRequest({ secrets: [GEMINI_API_KEY] }, (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const { message, history } = req.body;
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

      const contents = Array.isArray(history) && history.length > 0
        ? history.map((turn) => ({
            role: turn.role === "model" ? "model" : "user",
            parts: [{ text: turn.text }],
          }))
        : [{ role: "user", parts: [{ text: message }] }];

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction: `
Eres Veloi, el Agente Comercial de IA en WhatsApp para la 'Clínica Estética Veloi'.
Tu objetivo principal es responder dudas casuales, preguntas de servicios y objeciones de los prospectos de forma natural, guiándolos a agendar una cita o valoración.

Información de negocio:
- Tratamientos: Botox, Valoración Facial, Limpieza Profunda, Ácido Hialurónico.
- Precios de referencia: Valoraciones e hidratación desde COP $180.000.
- Ubicación: Sede Principal (atención previa cita).

Cómo agendar:
Cuando el prospecto quiera agendar una cita o valoración, pregúntale primero su nombre. Luego comparte este link personalizado para que reserve directamente: https://cal.com/talen-crew-vnposv/15min?name=NOMBRE_DEL_CLIENTE (reemplaza NOMBRE_DEL_CLIENTE por el nombre que te dio).

Reglas de respuesta:
1. Habla en tono latino natural, muy amable y profesional (estilo WhatsApp con algunos emojis).
2. Si el usuario hace preguntas casuales (ej: "¿hola cómo estás?", "¿dónde quedan?", "¿qué hacen?"), responde con calidez y conecta suavemente con la invitación a agendar.
3. Mantén las respuestas cortas (máximo 2 a 3 frases).
4. Sé proactiva impulsando el agendamiento: en cualquier tema que sí puedas responder con la información de arriba, después de responder intenta siempre avanzar la conversación hacia agendar una cita (ej. "¿te gustaría que te comparta el link para reservar tu cita?").
5. Da toda la información disponible arriba (tratamientos, precios de referencia, proceso de agendamiento) de una vez, sin hacer que el cliente tenga que insistir o repreguntar — entre menos fricción antes de agendar, mejor.
6. Si te preguntan algo fuera de la información de tratamientos, precios y agendamiento de arriba (preguntas médicas, quejas, o cualquier cosa que no sepas responder con certeza), no improvises la respuesta. Dile con calidez que un miembro del equipo le dará seguimiento personalmente para resolver eso. Esta regla no cambia por las reglas 4 y 5: sé agresiva impulsando la cita en lo que sí sabes responder, pero igual de cautelosa derivando a un humano en lo que no.
7. Si el usuario pide hablar con una persona o un humano pero SIN que haya de por medio una pregunta médica específica, una queja o un tema fuera de la información de arriba (es decir, es solo una preferencia general, como "prefiero hablar con alguien" o "¿hay una persona ahí?"), puedes responder con calidez que puedes ayudarle con la mayoría de preguntas sobre tratamientos, precios y agendamiento, e invitarlo a intentarlo primero. Pero no insistas ni te niegues a derivar si el usuario lo vuelve a pedir: en ese caso, deriva de inmediato. Esta regla nunca aplica por encima de la regla 6 — si la razón por la que quiere un humano es una pregunta médica específica o una queja, deriva de inmediato, sin intentar retenerlo primero.
          `,
        },
      });

      return res.status(200).json({ reply: response.text });
    } catch (error) {
      console.error("Error procesando IA:", error);
      return res.status(200).json({
        reply: "¡Hola! Claro que sí ✨ ¿Me regalas tu nombre para enviarte el link y agendar tu valoración?"
      });
    }
  });
});

// Webhook de WhatsApp Business Platform (Meta). GET: handshake de
// verificación al configurar la Callback URL en Meta for Developers.
// POST: mensajes entrantes reales.
exports.whatsappWebhook = onRequest({ secrets: [WHATSAPP_VERIFY_TOKEN, GEMINI_API_KEY, WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET] }, async (req, res) => {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN.value()) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Verification failed");
  }

  if (req.method === "POST") {
    if (!isValidMetaSignature(req, WHATSAPP_APP_SECRET.value())) {
      console.error("Firma X-Hub-Signature-256 inválida o ausente — payload rechazado.");
      return res.status(401).send("Invalid signature");
    }

    // A partir de aquí el payload ya está verificado como proveniente de
    // Meta. Meta siempre espera un 200 rápido en este endpoint, incluso si
    // algo falla internamente — por eso el catch también responde 200 en
    // vez de propagar el error (si no, Meta reintenta o puede deshabilitar
    // el webhook).
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const incomingMessage = value?.messages?.[0];
      const userText = incomingMessage?.text?.body;

      if (!phoneNumberId || !userText) {
        // Webhooks de status (entregado/leído) u otros eventos sin mensaje
        // de texto nuevo — no hay nada que responder.
        return res.status(200).send("EVENT_RECEIVED");
      }

      const botsSnap = await db.collection("bots")
        .where("whatsappPhoneId", "==", phoneNumberId)
        .limit(1)
        .get();

      if (botsSnap.empty) {
        console.error("No existe ningún bot con whatsappPhoneId:", phoneNumberId);
        return res.status(200).send("EVENT_RECEIVED");
      }

      const bot = botsSnap.docs[0].data();

      if (!bot.isActive) {
        console.log("Bot inactivo, se ignora el mensaje:", phoneNumberId);
        return res.status(200).send("EVENT_RECEIVED");
      }

      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: userText }] }],
        config: { systemInstruction: bot.systemPrompt },
      });

      const sendResult = await fetch(
        `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN.value()}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: incomingMessage.from,
            type: "text",
            text: { body: response.text },
          }),
        }
      );

      if (!sendResult.ok) {
        console.error(
          `Error enviando mensaje a ${incomingMessage.from} vía bot "${bot.botName}":`,
          sendResult.status,
          await sendResult.text()
        );
      } else {
        console.log(`Mensaje enviado a ${incomingMessage.from} vía bot "${bot.botName}".`);
      }

      // Mismo esquema que ya usa dashboard/client.html para leer conversations
      // (phoneId, userPhone, userName, userMessage, botReply, timestamp) —
      // hasta ahora solo existían documentos de prueba creados a mano.
      await db.collection("conversations").add({
        phoneId: phoneNumberId,
        userPhone: incomingMessage.from,
        userName: value?.contacts?.[0]?.profile?.name || null,
        userMessage: userText,
        botReply: response.text,
        timestamp: FieldValue.serverTimestamp(),
      });

      return res.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      console.error("Error procesando mensaje de WhatsApp:", error);
      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  return res.status(405).send("Method not allowed");
});

// TEMPORAL — solo para crear el bot de prueba del webhook de WhatsApp desde
// esta sesión (no hay credenciales de Admin SDK disponibles localmente).
// Protegida con el mismo secreto WHATSAPP_VERIFY_TOKEN (header x-seed-token)
// para que no sea un endpoint abierto a cualquiera. Se borra después de
// usarse una vez, no debe quedar desplegada.
exports.seedTestBot = onRequest({ secrets: [WHATSAPP_VERIFY_TOKEN] }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }
  if (req.get("x-seed-token") !== WHATSAPP_VERIFY_TOKEN.value()) {
    return res.status(401).send("Unauthorized");
  }

  const ref = await db.collection("bots").add({
    botName: "Clínica Prueba Webhook",
    whatsappPhoneId: "1234750543044836",
    isActive: true,
    systemPrompt: "Eres un asistente de prueba, responde brevemente confirmando que recibiste el mensaje.",
    createdAt: FieldValue.serverTimestamp(),
  });
  return res.status(200).json({ id: ref.id });
});
