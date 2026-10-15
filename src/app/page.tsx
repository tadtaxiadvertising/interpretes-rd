import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Globe2,
  Headphones,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { redirect } from "next/navigation";
import {
  resolveCurrentIdentity,
  resolveDestination,
} from "@/lib/identity/resolve-user";

export const dynamic = "force-dynamic";

const pillars = [
  {
    number: "01",
    icon: ClipboardCheck,
    title: "Postulación guiada",
    description:
      "Crea tu perfil, comparte tu experiencia e idiomas y conoce los pasos de evaluación. Tu avance queda organizado para que puedas retomarlo.",
  },
  {
    number: "02",
    icon: Headphones,
    title: "Portal del intérprete",
    description:
      "Consulta tu actividad, registra la producción permitida para tu rol y revisa minutos, horas y métricas desde un mismo espacio.",
  },
  {
    number: "03",
    icon: BarChart3,
    title: "Operaciones y reportes",
    description:
      "Los equipos autorizados gestionan candidatos, revisiones, intérpretes activos y reportes con trazabilidad y permisos definidos.",
  },
];

const stages = [
  ["01", "Regístrate", "Completa tus datos de contacto y crea tu perfil."],
  ["02", "Comparte tu experiencia", "Indica idiomas, habilidades y experiencia relevante."],
  ["03", "Completa las evaluaciones", "Sigue las instrucciones y etapas que te sean asignadas."],
  ["04", "Consulta tu progreso", "Revisa el estado de tu proceso y las siguientes acciones disponibles."],
];

export default async function RootPage() {
  const identity = await resolveCurrentIdentity();

  // Keep the existing authenticated routing behavior. Only anonymous visitors
  // receive the public marketing page.
  if (identity) {
    redirect(resolveDestination(identity));
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#07111f] text-slate-100">
      <header className="relative z-10 border-b border-white/10 bg-[#07111f]/90">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="Intérpretes RD, inicio">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2675ff] text-lg font-black text-slate-950">I</span>
            <span>
              <span className="block text-sm font-bold tracking-wide text-white">INTÉRPRETES RD</span>
              <span className="block text-xs text-slate-400">Plataforma de operaciones</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/5 sm:inline-flex">
              Iniciar sesión
            </Link>
            <Link href="/postular" className="inline-flex items-center gap-2 rounded-xl bg-[#2675ff] px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-[#8ab4ff]">
              Postularme <ArrowRight size={16} />
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative isolate">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_75%_10%,rgba(38,117,255,0.18),transparent_45%),radial-gradient(ellipse_at_15%_60%,rgba(38,117,255,0.12),transparent_40%)]" />
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.1fr_0.9fr] lg:py-32">
            <div>
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#8ab4ff]/20 bg-[#8ab4ff]/5 px-3.5 py-2 text-xs font-semibold tracking-wide text-[#8ab4ff]">
                <Globe2 size={15} /> PERSONAS · PROCESOS · OPERACIONES
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl lg:text-7xl">
                Conectamos idiomas con <span className="text-[#2675ff]">oportunidades reales.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                Intérpretes RD centraliza la postulación, el seguimiento profesional y la operación diaria de los intérpretes en una plataforma organizada, transparente y segura.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link href="/postular" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2675ff] px-6 py-3.5 font-bold text-slate-950 transition hover:bg-[#8ab4ff]">
                  Comenzar mi postulación <ArrowRight size={18} />
                </Link>
                <Link href="/login" className="inline-flex items-center justify-center rounded-xl border border-white/15 px-6 py-3.5 font-semibold text-white transition hover:bg-white/5">
                  Ya tengo una cuenta
                </Link>
              </div>
              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400">
                <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-[#2675ff]" /> Progreso organizado</span>
                <span className="inline-flex items-center gap-2"><ShieldCheck size={16} className="text-[#2675ff]" /> Accesos por rol</span>
                <span className="inline-flex items-center gap-2"><Workflow size={16} className="text-[#2675ff]" /> Procesos conectados</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl">
              <div className="absolute -inset-5 rounded-[2rem] bg-[#2675ff]/10 blur-3xl" />
              <div className="relative rounded-[2rem] border border-white/10 bg-[#0d1b2b]/95 p-5 shadow-2xl shadow-black/30 sm:p-7">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
                  <div>
                    <p className="text-sm text-slate-400">Tu espacio de trabajo</p>
                    <h2 className="mt-1 text-xl font-semibold text-white">Todo en un solo lugar</h2>
                  </div>
                  <span className="rounded-xl border border-[#8ab4ff]/20 bg-[#8ab4ff]/10 p-3 text-[#8ab4ff]"><Workflow size={22} /></span>
                </div>
                <div className="mt-5 space-y-3">
                  {[
                    { icon: Users, title: "Perfil y postulación", detail: "Información personal y experiencia", tag: "Candidatos" },
                    { icon: ClipboardCheck, title: "Etapas y evaluaciones", detail: "Pasos claros y seguimiento", tag: "Selección" },
                    { icon: Clock3, title: "Tiempo y producción", detail: "Actividad y métricas de trabajo", tag: "Intérpretes" },
                    { icon: ShieldCheck, title: "Gestión y control", detail: "Permisos, reportes y trazabilidad", tag: "Administración" },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.title} className="flex items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.035] p-4">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5 text-[#8ab4ff]"><Icon size={20} /></span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-white">{item.title}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-400">{item.detail}</p>
                        </div>
                        <span className="hidden rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-300 sm:inline-flex">{item.tag}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-5 text-xs leading-5 text-slate-500">Las funciones disponibles dependen de tu cuenta, etapa y permisos asignados.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="plataforma" className="border-y border-white/8 bg-white/[0.025]">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#2675ff]">Una plataforma, tres pilares</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Diseñada para acompañar todo el ciclo profesional.</h2>
              <p className="mt-5 leading-7 text-slate-300">Cada área tiene una responsabilidad clara y comparte la información necesaria sin duplicar procesos ni exponer datos a personas no autorizadas.</p>
            </div>
            <div className="mt-11 grid gap-5 md:grid-cols-3">
              {pillars.map((pillar) => {
                const Icon = pillar.icon;
                return (
                  <article key={pillar.number} className="rounded-2xl border border-white/10 bg-[#0b1928] p-6 sm:p-7">
                    <div className="flex items-center justify-between">
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2675ff]/10 text-[#8ab4ff]"><Icon size={23} /></span>
                      <span className="text-sm font-semibold text-slate-600">{pillar.number}</span>
                    </div>
                    <h3 className="mt-6 text-xl font-semibold text-white">{pillar.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-slate-300">{pillar.description}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="postulacion" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#2675ff]">Tu camino empieza aquí</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Un proceso paso a paso, sin perder de vista lo que sigue.</h2>
              <p className="mt-5 leading-7 text-slate-300">La postulación debe ayudarte a saber qué información necesitas, qué etapas has completado y cuándo debes realizar una nueva acción.</p>
              <Link href="/postular" className="mt-7 inline-flex items-center gap-2 font-bold text-[#8ab4ff] hover:text-[#a9c9ff]">
                Iniciar postulación <ArrowRight size={17} />
              </Link>
            </div>
            <ol className="space-y-4">
              {stages.map(([number, title, description]) => (
                <li key={number} className="flex gap-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#8ab4ff]/20 bg-[#8ab4ff]/5 text-sm font-bold text-[#8ab4ff]">{number}</span>
                  <div>
                    <h3 className="font-semibold text-white">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-300">{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="confianza" className="border-y border-white/8 bg-[#0b1928]">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-8 md:grid-cols-3">
            <div><ShieldCheck size={24} className="text-[#2675ff]" /><h3 className="mt-4 font-semibold text-white">Acceso responsable</h3><p className="mt-2 text-sm leading-6 text-slate-300">Cada persona debe acceder únicamente a la información y acciones que le corresponden.</p></div>
            <div><Workflow size={24} className="text-[#2675ff]" /><h3 className="mt-4 font-semibold text-white">Estados trazables</h3><p className="mt-2 text-sm leading-6 text-slate-300">Los procesos deben conservar su progreso y registrar los cambios importantes.</p></div>
            <div><BarChart3 size={24} className="text-[#2675ff]" /><h3 className="mt-4 font-semibold text-white">Datos útiles</h3><p className="mt-2 text-sm leading-6 text-slate-300">La producción y los reportes ayudan a organizar la operación con información verificable.</p></div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-20 text-center sm:px-8 sm:py-24">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">¿Listo para dar el siguiente paso?</h2>
          <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-300">Crea tu cuenta para comenzar o entra al portal si ya formas parte del equipo.</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/postular" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2675ff] px-6 py-3.5 font-bold text-slate-950 hover:bg-[#8ab4ff]">Quiero postularme <ArrowRight size={18} /></Link>
            <Link href="/login" className="inline-flex items-center justify-center rounded-xl border border-white/15 px-6 py-3.5 font-semibold text-white hover:bg-white/5">Iniciar sesión</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-7 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} Intérpretes RD</span>
          <div className="flex gap-5"><Link href="/login" className="hover:text-slate-300">Acceso al portal</Link><a href="#plataforma" className="hover:text-slate-300">La plataforma</a></div>
        </div>
      </footer>
    </div>
  );
}
