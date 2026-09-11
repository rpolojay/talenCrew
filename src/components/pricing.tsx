'use client';

import { Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PricingProps {
  onOpenDemo: () => void;
}

export function Pricing({ onOpenDemo }: PricingProps) {
  return (
    <section id="planes" className="py-20 bg-slate-950 border-t border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-emerald-400 font-semibold text-xs uppercase tracking-wider bg-emerald-950/60 border border-emerald-800/50 px-3 py-1 rounded-full inline-block mb-4">
            Planes Comerciales
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Inversión diseñada para convertir más prospectos
          </h2>
          <p className="mt-4 text-slate-400 text-base sm:text-lg">
            Configuración e implementación acompañada desde COP $500.000 para tu negocio.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto gap-8">
          
          {/* PLAN GROWTH */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 flex flex-col justify-between">
            <div>
              <h3 className="text-xl font-bold text-white mb-2">Veloi Growth</h3>
              <p className="text-slate-400 text-sm mb-6">
                Para negocios que quieren automatizar la atención y conversión de prospectos por WhatsApp.
              </p>
              <div className="mb-6">
                <span className="text-4xl font-black text-white">COP $699.000</span>
                <span className="text-slate-400 text-sm"> / mes</span>
              </div>
              <ul className="space-y-3.5 text-sm text-slate-300 mb-8">
                {[
                  'Agente de IA comercial en WhatsApp',
                  'Base de conocimiento de tus servicios',
                  'Calificación automática de prospectos',
                  'Agendamiento de citas y valoraciones',
                  'Derivación fluida a equipo humano',
                  'Dashboard de conversaciones y métricas',
                ].map((item, idx) => (
                  <li key={idx} className="flex items-center gap-3">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Button
              onClick={onOpenDemo}
              variant="outline"
              className="w-full border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 font-bold py-6 rounded-xl"
            >
              Quiero una demo personalizada
            </Button>
          </div>

          {/* PLAN REVENUE */}
          <div className="bg-gradient-to-b from-slate-900 to-emerald-950/30 border border-emerald-500/40 rounded-3xl p-8 flex flex-col justify-between relative shadow-xl">
            <span className="absolute -top-3.5 right-6 bg-emerald-500 text-slate-950 font-bold text-[10px] uppercase tracking-wider px-3 py-1 rounded-full">
              Más Recomendado
            </span>
            <div>
              <h3 className="text-xl font-bold text-white mb-2">Veloi Revenue</h3>
              <p className="text-slate-400 text-sm mb-6">
                Para negocios con mayor volumen de prospectos y necesidades comerciales avanzadas.
              </p>
              <div className="mb-6">
                <span className="text-4xl font-black text-white">COP $1.200.000</span>
                <span className="text-slate-400 text-sm"> / mes</span>
              </div>
              <ul className="space-y-3.5 text-sm text-slate-300 mb-8">
                {[
                  'Todo lo incluido en el plan Growth',
                  'Recuperación automática de prospectos olvidados',
                  'Secuencias avanzadas de seguimiento',
                  'Múltiples agendas y profesionales',
                  'Reporte avanzado de conversión e ingresos',
                  'Soporte prioritario y optimización continua',
                ].map((item, idx) => (
                  <li key={idx} className="flex items-center gap-3">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Button
              onClick={onOpenDemo}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-6 rounded-xl shadow-lg shadow-emerald-500/20"
            >
              Quiero una demo personalizada
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </div>

        </div>
      </div>
    </section>
  );
}
