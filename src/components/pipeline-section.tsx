'use client';

import { MessageSquare, Filter, Calendar, RefreshCw, UserCheck, ArrowRightLeft } from 'lucide-react';

export function PipelineSection() {
  const steps = [
    {
      icon: MessageSquare,
      title: 'RESPONDE',
      desc: 'Contesta inmediatamente preguntas sobre tus servicios, tratamientos, precios, horarios y ubicación.',
    },
    {
      icon: Filter,
      title: 'CALIFICA',
      desc: 'Identifica qué necesita el prospecto, su presupuesto y qué tan cerca está de tomar una decisión.',
    },
    {
      icon: Calendar,
      title: 'AGENDA',
      desc: 'Guía al prospecto de forma fluida hacia la reserva de su cita o valoración en tu agenda.',
    },
    {
      icon: RefreshCw,
      title: 'HACE SEGUIMIENTO',
      desc: 'No deja morir una oportunidad simplemente porque el prospecto no respondió al primer mensaje.',
    },
    {
      icon: UserCheck,
      title: 'RECUPERA',
      desc: 'Vuelve a contactar prospectos que preguntaron en el pasado pero nunca llegaron a reservar.',
    },
    {
      icon: ArrowRightLeft,
      title: 'ENTREGA A TU EQUIPO',
      desc: 'Deriva la conversación a una persona de tu equipo en el momento exacto en que se requiere intervención humana.',
    },
  ];

  return (
    <section className="py-20 bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-emerald-400 font-semibold text-xs uppercase tracking-wider bg-emerald-950/60 border border-emerald-800/50 px-3 py-1 rounded-full inline-block mb-4">
            Proceso Comercial Completo
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Veloi trabaja como un agente comercial en tu WhatsApp.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-400">
            Un flujo automatizado diseñado para acompañar al cliente desde el primer mensaje hasta la conversión.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 hover:border-emerald-500/40 transition-all">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5">
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{step.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{step.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
