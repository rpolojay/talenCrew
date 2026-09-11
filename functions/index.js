const { onRequest } = require("firebase-functions/v2/https");
const cors = require("cors")({ origin: true });
const { GoogleGenAI } = require("@google/genai");

// Replace with your actual Gemini API Key or pass via environment variable
const GEMINI_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6IulOLkjT2sJ7IBJ3-A5Ved5w3nYvLQXJreTd5Q9r9qSQ";
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

exports.liveDemoAgent = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const { message } = req.body;

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
- Disponibilidad: Jueves a las 3:30 PM y Viernes a las 11:00 AM.
- Ubicación: Sede Principal (atención previa cita).

Reglas de respuesta:
1. Habla en tono latino natural, muy amable y profesional (estilo WhatsApp con algunos emojis).
2. Si el usuario hace preguntas casuales (ej: "¿hola cómo estás?", "¿dónde quedan?", "¿qué hacen?"), responde con calidez y conecta suavemente con la invitación a agendar.
3. Mantén las respuestas cortas (máximo 2 a 3 frases).
          `,
        },
      });

      return res.status(200).json({ reply: response.text });
    } catch (error) {
      console.error("Error procesando IA:", error);
      return res.status(200).json({ 
        reply: "¡Hola! Claro que sí ✨ ¿Te gustaría conocer los horarios disponibles para agendar tu valoración esta semana?" 
      });
    }
  });
});