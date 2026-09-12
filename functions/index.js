const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const cors = require("cors")({ origin: true });
const { GoogleGenAI } = require("@google/genai");

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

exports.liveDemoAgent = onRequest({ secrets: [GEMINI_API_KEY] }, (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const { message } = req.body;
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: message,
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
4. Si te preguntan algo fuera de la información de tratamientos, precios y agendamiento de arriba (preguntas médicas, quejas, o cualquier cosa que no sepas responder con certeza), no improvises la respuesta. Dile con calidez que un miembro del equipo le dará seguimiento personalmente para resolver eso.
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
