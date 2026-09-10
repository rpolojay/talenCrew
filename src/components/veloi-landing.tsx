'use client';

import { useState } from 'react';
import { Navbar } from '@/components/navbar';
import { WhatsAppPhone } from '@/components/whatsapp-phone';
import { ProblemSection } from '@/components/problem-section';
import { PipelineSection } from '@/components/pipeline-section';
import { RecoverySection } from '@/components/recovery-section';
import { InteractiveDemo } from '@/components/interactive-demo';
import { DashboardPreview } from '@/components/dashboard-preview';
import { UseCases } from '@/components/use-cases';
import { Pricing } from '@/components/pricing';
import { FAQ } from '@/components/faq';
import { Footer } from '@/components/footer';
import { DemoModal } from '@/components/demo-modal';
import { Button } from '@/components/ui/button';
import { MessageSquare, ArrowRight, CheckCircle, ShieldCheck } from 'lucide-react';

export function VeloiLanding() {
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);

  const handleOpenDemo = () => setIsDemoModalOpen(true);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar onOpenDemo={handleOpenDemo} />

      <main className="flex-grow">
        {/* HERO SECTION */}
        <section className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900/80 to-slate-950">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
              
              <div className="lg:col-span-7 text-left space-y-6">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                  <ShieldCheck className="w-4 h-4" />
                  Agente Comercial de IA para WhatsApp
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-[1.15]">
                  Convierte tus conversaciones de WhatsApp en <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200">clientes.</span>
                </h1>

                <p className="text-lg sm:text-xl text-slate-300 font-normal leading-relaxed max-w-2xl">
                  Veloi responde, califica, agenda y hace seguimiento automático a tus prospectos — 24/7.
                </p>

                <p className="text-sm sm:text-base text-slate-400 border-l-2 border-emerald-500/60 pl-4 py-1 italic">
                  Deja de perder clientes porque nadie respondió, hizo seguimiento o confirmó una cita. Veloi trabaja en WhatsApp como un agente comercial para tu negocio.
                </p>

                <div className="pt-4 flex flex-col sm:flex-row gap-4">
                  <Button
                    onClick={handleOpenDemo}
                    size="lg"
                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-6 rounded-xl shadow-lg shadow-emerald-500/20 text-base transition-all transform hover:-translate-y-0.5"
                  >
                    Quiero una demo personalizada
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>

                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-slate-200 font-semibold px-6 py-6 rounded-xl text-base"
                  >
                    <a href="#demostración">Ver cómo funciona</a>
                  </Button>
                </div>

                <div className="pt-6 flex items-center gap-6 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-400" /> Sin instalación compleja
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-400" /> Configurado para tu negocio
                  </span>
                </div>
              </div>

              <div className="lg:col-span-5 flex justify-center relative">
                <WhatsAppPhone />
              </div>

            </div>
          </div>
        </section>

        {/* NEW CONVERSION SECTIONS */}
        <ProblemSection />
        <PipelineSection />
        <RecoverySection />

        {/* DEMO & DASHBOARD */}
        <section id="demostración">
          <InteractiveDemo onOpenDemo={handleOpenDemo} />
        </section>

        <DashboardPreview />
        <UseCases />

        {/* IMPLEMENTATION */}
        <section className="py-20 bg-slate-900/40 border-t border-slate-800/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <span className="text-emerald-400 font-semibold text-sm uppercase tracking-wider bg-emerald-950/60 border border-emerald-800/50 px-3 py-1 rounded-full inline-block mb-4">
                Puesta en Marcha
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                Implementación orientada por nuestro equipo
              </h2>
              <p className="mt-4 text-lg text-slate-400">
                No requerimos que configures flujos complejos. Nos encargamos del ajuste inicial para que tu agente comience a operar.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  num: '1',
                  title: 'CONECTAMOS',
                  desc: 'Conectamos Veloi con tu canal de WhatsApp y recopilamos la información clave de tus servicios y oferta.',
                },
                {
                  num: '2',
                  title: 'CONFIGURAMOS',
                  desc: 'Configuramos precios, preguntas frecuentes, disponibilidad de agenda y reglas comerciales específicas.',
                },
                {
                  num: '3',
                  title: 'EMPIEZA A CONVERTIR',
                  desc: 'Veloi comienza a responder, calificar, agendar citas y realizar seguimiento constante a tus prospectos.',
                },
              ].map((step, idx) => (
                <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl p-8 relative">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold flex items-center justify-center mb-6 text-lg">
                    {step.num}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{step.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Pricing onOpenDemo={handleOpenDemo} />
        <FAQ />

        {/* FINAL CTA */}
        <section className="py-20 bg-gradient-to-br from-emerald-950/80 via-slate-900 to-slate-950 border-t border-emerald-800/40 text-center relative overflow-hidden">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 relative z-10">
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-6">
              Cada conversación puede convertirse en un cliente.
            </h2>
            <p className="text-slate-300 text-lg sm:text-xl mb-8 max-w-2xl mx-auto">
              Descubre cómo Veloi puede ayudarte a responder, convertir y recuperar más oportunidades desde tu canal de WhatsApp.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                onClick={handleOpenDemo}
                size="lg"
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-6 rounded-xl shadow-xl shadow-emerald-500/20 text-base"
              >
                Quiero una demo personalizada
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>

              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200 font-semibold px-6 py-6 rounded-xl text-base"
              >
                <a href="#demostración">
                  <MessageSquare className="mr-2 w-5 h-5 text-emerald-400" />
                  Hablar con Veloi
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />

      <DemoModal isOpen={isDemoModalOpen} onClose={() => setIsDemoModalOpen(false)} />
    </div>
  );
}
