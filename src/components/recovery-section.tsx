'use client';

import { Repeat, CheckCircle2 } from 'lucide-react';

export function RecoverySection() {
  return (
    <section className="py-20 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-3xl p-8 sm:p-12 relative overflow-hidden shadow-2xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            
            <div className="lg:col-span-7 space-y-6">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                <Repeat className="w-4 h-4" />
                Diferencial Clave
              </span>

              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                No solo respondas. <br className="hidden sm:inline" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200">
                  Recupera las oportunidades que ya tienes.
                </span>
              </h2>

              <p className="text-slate-300 text-base sm:text-lg leading-relaxed">
                Muchos prospectos preguntan, comparan opciones o dicen &quot;lo voy a pensar&quot;. Sin seguimiento, esas conversaciones terminan olvidadas. Veloi identifica oportunidades que no terminaron de agendar y automatiza el seguimiento adecuado.
              </p>

              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-sm text-emerald-400 font-medium italic">
                &ldquo;Tu equipo responde las conversaciones nuevas. Veloi ayuda a recuperar las antiguas.&rdquo;
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-sm text-slate-300">
                {[
                  'Prospectos que preguntaron precios',
                  'Personas que no terminaron de agendar',
                  'Citas pendientes de confirmación',
                  'Citas canceladas por reprogramar',
                  'Clientes de re-atención periódica',
                  'Leads que dejaron de responder',
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5 bg-slate-950 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-6 text-center border-b border-slate-800 pb-3">
                Flujo de Recuperación de Oportunidades
              </h3>
              
              <div className="space-y-3 font-mono text-xs">
                {[
                  { step: '1. Nuevo Prospecto', desc: 'Consulta inicial por WhatsApp', color: 'border-slate-800 text-slate-300' },
                  { step: '2. Atención e Información', desc: 'Veloi aclara dudas y califica', color: 'border-slate-800 text-slate-300' },
                  { step: '3. Pausa en Conversación', desc: 'El prospecto no confirma fecha', color: 'border-amber-500/30 text-amber-300 bg-amber-950/20' },
                  { step: '4. Seguimiento Automático', desc: 'Veloi reactiva el interés', color: 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30' },
                  { step: '5. Cita Confirmada', desc: 'Oportunidad recuperada exitosamente', color: 'border-emerald-500 text-white bg-emerald-600/20' },
                ].map((f, i) => (
                  <div key={i} className={`p-3 rounded-xl border ${f.color}`}>
                    <div className="font-bold">{f.step}</div>
                    <div className="text-[11px] opacity-80 mt-0.5">{f.desc}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
