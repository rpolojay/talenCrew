'use client';

export function FAQ() {
  const faqs = [
    {
      q: '¿Veloi reemplaza a mi equipo comercial o de recepción?',
      a: 'No. Veloi actúa como un asistente comercial 24/7 que atiende consultas iniciales, califica al prospecto y agenda citas. Cuando una conversación requiere criterio humano o atención personalizada, la entrega a tu equipo.',
    },
    {
      q: '¿Necesito cambiar mi número de WhatsApp actual?',
      a: 'No. Veloi se integra directamente con tu línea comercial de WhatsApp para que tus clientes sigan escribiendo al mismo número de siempre.',
    },
    {
      q: '¿Cómo funciona la recuperación de prospectos olvidados?',
      a: 'Veloi detecta conversaciones donde el prospecto solicitó información pero no confirmó una cita. Tras un tiempo prudencial, envía un mensaje de seguimiento natural para retomar la oportunidad.',
    },
    {
      q: '¿Cuánto tiempo toma la implementación?',
      a: 'Nuestro equipo se encarga de la configuración inicial en 3 a 5 días hábiles, incluyendo la carga de tu oferta de servicios, precios, disponibilidad de agenda y reglas comerciales.',
    },
    {
      q: '¿Qué información necesitan de mi negocio?',
      a: 'Solo requerimos tu catálogo de servicios, precios, preguntas frecuentes habituales y los horarios de atención para que el agente responda con exactitud.',
    },
  ];

  return (
    <section className="py-20 bg-slate-900/40 border-t border-slate-800">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-white tracking-tight">Preguntas Frecuentes</h2>
          <p className="mt-3 text-slate-400 text-sm sm:text-base">
            Todo lo que necesitas saber antes de implementar Veloi en tu negocio.
          </p>
        </div>

        <div className="space-y-6">
          {faqs.map((faq, idx) => (
            <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-2">{faq.q}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
