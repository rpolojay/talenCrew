'use client';

import { Clock, MessageX, CalendarX, UserMinus } from 'lucide-react';

export function ProblemSection() {
  const problems = [
    {
      icon: Clock,
      title: '"¿Cuánto cuesta?"',
      desc: 'El prospecto pregunta interesado, pero la respuesta llega demasiado tarde y termina buscando a la competencia.',
    },
    {
      icon: MessageX,
      title: '"Lo voy a pensar."',
      desc: 'El prospecto tenía intención real, pero nadie volvió a contactarlo ni a responder sus objeciones a tiempo.',
    },
    {
      icon: CalendarX,
      title: '"¿Tienen disponibilidad?"',
      desc: 'La conversación se dilata entre responder horarios y el prospecto nunca llega a confirmar su cita.',
    },
    {
      icon: UserMinus,
      title: '"Ya les escribí..."',
      desc: 'Tu equipo está ocupado atendiendo el día a día y decenas de conversaciones activas quedan en el olvido.',
    },
  ];

  return (
    <section className="py-20 bg-slate-900/60 border-t border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-emerald-400 font-semibold text-xs uppercase tracking-wider bg-emerald-950/60 border border-emerald-800/50 px-3 py-1 rounded-full inline-block mb-4">
            El Desafío Comercial
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Tu WhatsApp está lleno de oportunidades que nadie está siguiendo.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-400">
            Cada día pierdes clientes potenciales no por falta de interés, sino por demoras en atención y falta de seguimiento constante.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {problems.map((prob, idx) => {
            const IconComponent = prob.icon;
            return (
              <div key={idx} className="bg-slate-900 border border-slate-800/90 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition-all">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mb-5">
                    <IconComponent className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{prob.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{prob.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
