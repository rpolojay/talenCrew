'use client';

import { Card } from '@/components/ui/card';
import { Clock, HelpCircle, CalendarX, UserX } from 'lucide-react';

const painPoints = [
  {
    icon: Clock,
    title: '"¿Cuánto cuesta?"',
    description: 'El prospecto pregunta en WhatsApp y la respuesta llega demasiado tarde. Para cuando respondieron, ya cotizó con la competencia.',
  },
  {
    icon: HelpCircle,
    title: '"Lo voy a pensar."',
    description: 'El prospecto estaba altamente interesado en el tratamiento o servicio, pero nadie vuelve a contactarlo para resolver dudas o hacer seguimiento.',
  },
  {
    icon: CalendarX,
    title: '"¿Tienen disponibilidad?"',
    description: 'La conversación sobre horarios se vuelve lenta e interrumpida. Se pierde la fluidez y nunca se concreta la reserva.',
  },
  {
    icon: UserX,
    title: '"Ya les escribí."',
    description: 'El equipo humano está ocupado atendiendo clientes presenciales. El cliente digital termina buscando otra opción que responda primero.',
  },
];

export function ProblemSection() {
  return (
    <section className="py-20 bg-slate-900/60 border-y border-slate-800/80 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-emerald-400 font-semibold text-sm uppercase tracking-wider bg-emerald-950/60 border border-emerald-800/50 px-3 py-1 rounded-full inline-block mb-4">
            El reto comercial en WhatsApp
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Tu WhatsApp está lleno de oportunidades que nadie está siguiendo.
          </h2>
          <p className="mt-4 text-lg text-slate-400">
            Cada día ingresan prospectos buscando soluciones inmediatas. La falta de respuesta al instante y la falta de seguimiento sistemático destruyen tus conversiones.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {painPoints.map((item, idx) => {
            const Icon = item.icon;
            return (
              <Card key={idx} className="bg-slate-900/90 border-slate-800 p-6 flex flex-col justify-between hover:border-slate-700 transition-all duration-200">
                <div>
                  <div className="w-12 h-12 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5 text-red-400">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-100 mb-2">{item.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{item.description}</p>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
