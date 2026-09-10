'use client';

import { useState } from 'react';
import { ProblemSection } from '@/components/problem-section';
import { PipelineSection } from '@/components/pipeline-section';
import { RecoverySection } from '@/components/recovery-section';

export default function Page() {
  const [isDemoOpen, setIsDemoOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      
      {/* HEADER / NAVIGATION */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black text-white tracking-wider">VELOI<span className="text-emerald-400">APP</span></span>
          </div>
          <button
            onClick={() => setIsDemoOpen(true)}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
          >
            Quiero una demo personalizada
          </button>
        </div>
      </header>

      <main className="flex-grow pt-20">
        {/* HERO SECTION */}
        <section className="relative pt-20 pb-16 md:pt-28 md:pb-24 bg-gradient-to-b from-slate-950 via-slate-900/80 to-slate-950 border-b border-slate-800/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <span className="inline-block px-3 py-1.5 mb-6 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
              Agente Comercial de IA para WhatsApp
            </span>
            <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-tight max-w-4xl mx-auto">
              Convierte tus conversaciones de WhatsApp en <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200">clientes.</span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
              Veloi responde, califica, agenda y hace seguimiento automático a tus prospectos — 24/7.
            </p>
            <p className="mt-4 text-sm sm:text-base text-slate-400 max-w-xl mx-auto italic">
              Deja de perder clientes porque nadie respondió, hizo seguimiento o confirmó una cita.
            </p>
            <div className="mt-8 flex items-center justify-center gap-4">
              <button
                onClick={() => setIsDemoOpen(true)}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-4 rounded-xl text-base shadow-lg shadow-emerald-500/20 transition-all"
              >
                Quiero una demo personalizada
              </button>
            </div>
          </div>
        </section>

        {/* CONVERSION SECTIONS */}
        <ProblemSection />
        <PipelineSection />
        <RecoverySection />

        {/* FINAL CTA SECTION */}
        <section className="py-20 bg-slate-900/60 border-t border-slate-800 text-center">
          <div className="max-w-3xl mx-auto px-4">
            <h2 className="text-3xl font-bold text-white mb-4">Cada conversación puede convertirse en un cliente.</h2>
            <p className="text-slate-400 mb-8">Descubre cómo Veloi te ayuda a responder, convertir y recuperar más oportunidades.</p>
            <button
              onClick={() => setIsDemoOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-4 rounded-xl text-base"
            >
              Quiero una demo personalizada
            </button>
          </div>
        </section>
      </main>

      {/* SIMPLE DEMO MODAL */}
      {isDemoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-2">Solicitar Demo Personalizada</h3>
            <p className="text-sm text-slate-400 mb-4">Ingresa tus datos y configuraremos una prueba ajustada a tu negocio.</p>
            <form onSubmit={(e) => { e.preventDefault(); setIsDemoOpen(false); alert('¡Gracias! Nos pondremos en contacto pronto.'); }} className="space-y-4">
              <input type="text" placeholder="Nombre" required className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white text-sm" />
              <input type="text" placeholder="Nombre de tu negocio" required className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white text-sm" />
              <input type="tel" placeholder="Número de WhatsApp" required className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white text-sm" />
              <button type="submit" className="w-full bg-emerald-500 text-slate-950 font-bold p-3 rounded-lg text-sm">Enviar Solicitud</button>
            </form>
            <button onClick={() => setIsDemoOpen(false)} className="mt-4 text-xs text-slate-500 w-full text-center">Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
