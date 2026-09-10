'use client';

import { RotateCcw, CheckCircle2, ArrowRight } from 'lucide-react';

const recoveryScenarios = [
  'Prospectos que preguntaron precios de tratamientos y no continuaron.',
  'Personas que mostraron interés pero no concluyeron la reserva.',
  'Citas agendadas pendientes de confirmación previa.',
  'Citas canceladas que pueden reagendarse.',
  'Clientes antiguos que no han vuelto a agendar una valoración.',
];

export function RecoverySection() {
  return (
    <section className="py-20 bg-gradient-to-b from-slate-900/90 to-slate-950 border-y border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <span className="text-emerald-400 font-semibold text-sm uppercase tracking-wider bg-emerald-950/60 border border-emerald-800/50 px-3 py-1 rounded-full inline-block mb-4">
              Diferenciador Clave
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              No solo respondas. Recupera las oportunidades que ya tienes.
            </h2>
            <p className="mt-4 text-slate-300 text-lg leading-relaxed">
              Muchos prospectos preguntan, comparan opciones o dicen <em className="text-white italic">&quot;lo voy a pensar&quot;</em>. Sin seguimiento, esas conversaciones terminan olvidadas en el historial.
            </p>
            <p className="mt-2 text-slate-400 text-base">
              Veloi identifica oportunidades que no terminaron de agendar y automatiza el seguimiento adecuado en el momento justo.
            </p>

            <blockquote className="my-6 p-4 bg-emerald-950/30 border-l-4 border-emerald-500 text-slate-200 text-sm font-medium rounded-r-lg">
              &quot;Tu equipo responde las conversaciones nuevas. Veloi ayuda a recuperar las antiguas.&quot;
            </blockquote>

            <div className="space-y-3 mt-6">
              {recoveryScenarios.map((scen, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="text-slate-300 text-sm">{scen}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl relative">
            <div className="absolute top-3 right-4 text-[10px] uppercase font-mono tracking-wider text-slate-500 bg-slate-800/80 px-2.5 py-1 rounded">
              Ejemplo / Concepto
            </div>

            <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-emerald-400" />
              Ciclo de Conversión Veloi
            </h3>

            <div className="space-y-3">
              {[
                { label: '1. Nuevo Prospecto Inicia Chat', desc: 'Pregunta por tratamiento/precio' },
                { label: '2. Veloi Responde & Califica', desc: 'Suministra información e identifica interés' },
                { label: '3. El Prospecto No Reserva', desc: 'Dice "gracias, lo voy a pensar"' },
                { label: '4. Seguimiento Programado Veloi', desc: 'Envía un recordatorio de valor o promo' },
                { label: '5. Oportunidad Recuperada', desc: 'El prospecto agenda su cita de valoración' },
              ].map((step, idx) => (
                <div key={idx} className="relative">
                  <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-emerald-400">{step.label}</div>
                      <div className="text-xs text-slate-400">{step.desc}</div>
                    </div>
                  </div>
                  {idx < 4 && (
                    <div className="flex justify-center my-1">
                      <ArrowRight className="w-4 h-4 text-slate-600 rotate-90" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
