'use client';

import { MessageSquare, UserCheck, Calendar, RefreshCw, RotateCcw, UserCheck2 } from 'lucide-react';

const pipelineSteps = [
  {
    step: '01',
    title: 'RESPONDE',
    icon: MessageSquare,
    description: 'Contesta preguntas sobre tus servicios, precios, horarios y condiciones al instante, 24/7.',
  },
  {
    step: '02',
    title: 'CALIFICA',
    icon: UserCheck,
    description: 'Identifica qué necesita el prospecto, cuál es su interés real y qué tan cerca está de comprar.',
  },
  {
    step: '03',
    title: 'AGENDA',
    icon: Calendar,
    description: 'Guía al prospecto hacia una cita, valoración o siguiente paso directo en la agenda.',
  },
  {
    step: '04',
    title: 'HACE SEGUIMIENTO',
    icon: RefreshCw,
    description: 'No deja morir una oportunidad simplemente porque el prospecto dejó de responder en algún punto.',
  },
  {
    step: '05',
    title: 'RECUPERA',
    icon: RotateCcw,
    description: 'Vuelve a contactar oportunidades que preguntaron en el pasado pero nunca llegaron a reservar.',
  },
  {
    step: '06',
    title: 'ENTREGA A TU EQUIPO',
    icon: UserCheck2,
    description: 'Cuando una conversación requiere atención humana directa, Veloi la deriva sin perder el contexto.',
  },
];

export function PipelineSection() {
  return (
    <section className="py-20 bg-slate-950 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-emerald-400 font-semibold text-sm uppercase tracking-wider bg-emerald-950/60 border border-emerald-800/50 px-3 py-1 rounded-full inline-block mb-4">
            Proceso Comercial Inteligente
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Veloi trabaja como un agente comercial en tu WhatsApp.
          </h2>
          <p className="mt-4 text-lg text-slate-400">
            Mucho más que un chatbot tradicional: una estructura de venta en 6 etapas orientada a la conversión de clientes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {pipelineSteps.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="relative bg-slate-900/60 border border-slate-800 rounded-xl p-6 hover:border-emerald-500/40 transition-all group"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:bg-emerald-500 group-hover:text-slate-950 transition-all duration-300">
                    <Icon className="w-6 h-6" />
                  </div>
                  <span className="text-2xl font-black text-slate-700 group-hover:text-emerald-500/40 transition-colors">
                    {item.step}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
