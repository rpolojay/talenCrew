'use client';

import { CheckCheck, Sparkles } from 'lucide-react';

export function WhatsAppPhone() {
  return (
    <div className="w-full max-w-[340px] sm:max-w-[380px] bg-slate-900 border-4 border-slate-800 rounded-[40px] shadow-2xl overflow-hidden relative">
      {/* PHONE HEADER */}
      <div className="bg-slate-950 px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center font-bold text-emerald-400 text-sm">
              CL
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 border-2 border-slate-950 rounded-full"></span>
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-1.5">
              Clínica Estética Veloi
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-[11px] text-emerald-400 font-medium">Agente Comercial Veloi • En línea</div>
          </div>
        </div>
      </div>

      {/* CHAT MESSAGES BODY */}
      <div className="p-4 space-y-3 bg-slate-950/90 min-h-[420px] text-xs leading-relaxed">
        
        {/* CUSTOMER MESSAGE */}
        <div className="bg-slate-900 border border-slate-800 text-slate-200 p-3 rounded-2xl rounded-tl-none max-w-[85%]">
          Hola 👋 Quisiera información sobre precios para tratamiento facial o Botox.
          <div className="text-[10px] text-slate-500 text-right mt-1">10:14 AM</div>
        </div>

        {/* VELOI RESPONSE */}
        <div className="bg-emerald-950/70 border border-emerald-800/60 text-emerald-100 p-3 rounded-2xl rounded-tr-none max-w-[88%] ml-auto">
          ¡Hola! Claro que sí ✨ Con gusto te orientamos. Manejamos valoración personalizada para determinar la dosis adecuada. ¿Buscas prevenir líneas o tratar alguna zona en específico?
          <div className="text-[10px] text-emerald-400/80 text-right mt-1 flex items-center justify-end gap-1">
            10:14 AM <CheckCheck className="w-3 h-3 text-emerald-400" />
          </div>
        </div>

        {/* CUSTOMER RESPONSE */}
        <div className="bg-slate-900 border border-slate-800 text-slate-200 p-3 rounded-2xl rounded-tl-none max-w-[85%]">
          Principalmente frente y entrecejo. ¿Qué disponibilidad tienen esta semana?
          <div className="text-[10px] text-slate-500 text-right mt-1">10:15 AM</div>
        </div>

        {/* VELOI QUALIFY & BOOK */}
        <div className="bg-emerald-950/70 border border-emerald-800/60 text-emerald-100 p-3 rounded-2xl rounded-tr-none max-w-[88%] ml-auto">
          Perfecto. Tenemos agenda disponible con la Dra. Martínez para este **Jueves a las 3:30 PM** o **Viernes a las 11:00 AM**. ¿Cuál te convine mejor para reservar tu valoración?
          <div className="text-[10px] text-emerald-400/80 text-right mt-1 flex items-center justify-end gap-1">
            10:15 AM <CheckCheck className="w-3 h-3 text-emerald-400" />
          </div>
        </div>

        {/* DEMO NOTICE BADGE */}
        <div className="text-center pt-2">
          <span className="text-[10px] uppercase font-mono tracking-wider bg-slate-900 border border-slate-800 text-slate-400 px-3 py-1 rounded-full">
            Ejemplo de Conversación Real
          </span>
        </div>

      </div>
    </div>
  );
}
