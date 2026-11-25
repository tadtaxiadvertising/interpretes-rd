"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useMemo, use, useRef } from "react";
import { getInterpretersForSelect, createManualLog } from "@/app/actions/manual-logs";
import { Clock, Calendar, CheckCircle2, AlertCircle, Search, Loader2, User } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const manualLogSchema = z.object({
  interpreterExternalId: z.string().min(1, "Debe seleccionar un intérprete"),
  date: z.string().min(1, "La fecha es requerida"),
  startTime: z.string().min(1, "Hora de inicio es requerida"),
  endTime: z.string().min(1, "Hora de fin es requerida"),
}).refine(data => {
  if (!data.date || !data.startTime || !data.endTime) return true;
  const start = new Date(`${data.date}T${data.startTime}:00`).getTime();
  const end = new Date(`${data.date}T${data.endTime}:00`).getTime();
  return end > start;
}, {
  message: "La hora de fin debe ser posterior a la hora de inicio",
  path: ["endTime"]
});

type ManualLogForm = z.infer<typeof manualLogSchema>;

export default function ManualLogPage(props: { params: Promise<any> }) {
  const params = use(props.params);
  
  const [interpreters, setInterpreters] = useState<{ id: number; name: string; externalId: string }[]>([]);
  const [selectedInterpreter, setSelectedInterpreter] = useState<{ id: number; name: string; externalId: string } | null>(null);
  const searchRequestRef = useRef(0);
  const [search, setSearch] = useState("");
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<ManualLogForm>({
    resolver: zodResolver(manualLogSchema),
    defaultValues: {
      interpreterExternalId: "",
      date: "",
      startTime: "",
      endTime: ""
    }
  });

  const watchInterpreterId = watch("interpreterExternalId");
  const watchDate = watch("date");
  const watchStartTime = watch("startTime");
  const watchEndTime = watch("endTime");

  useEffect(() => {
    const requestId = ++searchRequestRef.current;
    const timeout = setTimeout(async () => {
      setLoadingInitial(true);
      try {
        const res = await getInterpretersForSelect(search.trim());
        if (requestId === searchRequestRef.current && res.success && res.data) {
          setInterpreters(res.data);
        }
      } finally {
        if (requestId === searchRequestRef.current) setLoadingInitial(false);
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [search]);

  const filteredInterpreters = useMemo(() => interpreters.slice(0, 100), [interpreters]);

  const livePreviewMinutes = useMemo(() => {
    if (!watchDate || !watchStartTime || !watchEndTime) return 0;
    const start = new Date(`${watchDate}T${watchStartTime}:00`);
    const end = new Date(`${watchDate}T${watchEndTime}:00`);
    const diff = end.getTime() - start.getTime();
    if (diff <= 0 || isNaN(diff)) return 0;
    return Math.floor(diff / 60000);
  }, [watchDate, watchStartTime, watchEndTime]);

  const onSubmit = async (data: ManualLogForm) => {
    if (!selectedInterpreter) return;
    setMessage(null);
    try {
      const res = await createManualLog({
        interpreterId: selectedInterpreter.id,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        totalMinutes: livePreviewMinutes
      });

      if (!res.success) {
        throw new Error(res.error || "Ocurrió un error al registrar en el API");
      }

      setMessage({ type: "success", text: "Registro manual creado exitosamente." });
      reset();
      setSearch("");
      setSelectedInterpreter(null);
    } catch (error: any) {
      console.error(error);
      setMessage({ type: "error", text: error.message || "Ocurrió un error inesperado." });
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--foreground)]">Registro Manual de Tiempos</h1>
        <p className="text-[var(--text-secondary)] mt-2">
          Agrega horas interpretadas manualmente. Validado mediante Zod y enviado al Backend API.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <form onSubmit={handleSubmit(onSubmit)} className="lg:col-span-2 space-y-6 bg-[var(--theme-panel)] border border-[var(--border)] p-6 rounded-xl shadow-lg">
          
          <div className="space-y-3">
            <label className="text-sm font-medium text-[var(--foreground)] flex items-center gap-2">
              <User className="w-4 h-4 text-[var(--theme-link)]" />
              Seleccionar Intérprete
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-5 w-5 text-[var(--text-tertiary)]" />
              <input
                type="text"
                placeholder="Buscar por nombre o ID..."
                className="w-full pl-10 pr-4 py-3 bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-lg text-[var(--theme-control-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {errors.interpreterExternalId && <span className="text-[var(--theme-danger)] text-sm">{errors.interpreterExternalId.message}</span>}
            
            {loadingInitial ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando intérpretes...
              </div>
            ) : (
              <>
                <p className="text-xs text-[var(--text-tertiary)]">Mostrando hasta 100 coincidencias; escribe el nombre o ID completo para localizar cualquier intérprete.</p>
                <div className="max-h-60 overflow-y-auto border border-[var(--border)] rounded-lg bg-[var(--theme-panel)] scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                {filteredInterpreters.length === 0 ? (
                  <div className="p-4 text-sm text-[var(--text-secondary)] text-center">No se encontraron resultados.</div>
                ) : (
                  filteredInterpreters.map((int) => (
                    <button
                      type="button"
                      key={int.id}
                      onClick={() => {
                        setSelectedInterpreter(int);
                        setValue("interpreterExternalId", int.externalId, { shouldValidate: true });
                      }}
                      className={`w-full text-left px-4 py-3 hover:bg-[var(--theme-hover)] transition-colors flex items-center justify-between border-b border-[var(--border)] last:border-0 ${
                        watchInterpreterId === int.externalId ? "bg-[var(--theme-surface-muted)] border-l-4 border-l-blue-500" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs bg-[var(--theme-surface-muted)] text-[var(--theme-link)] px-2 py-1 rounded-md">[{int.externalId}]</span>
                        <span className={`text-sm ${watchInterpreterId === int.externalId ? "text-[var(--foreground)] font-medium" : "text-[var(--text-secondary)]"}`}>{int.name}</span>
                      </div>
                      {watchInterpreterId === int.externalId && <CheckCircle2 className="w-4 h-4 text-[var(--theme-link)]" />}
                    </button>
                  ))
                )}
                </div>
              </>
            )}
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-[var(--foreground)] flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[var(--theme-link)]" />
              Fecha
            </label>
            <div className="relative">
              <input
                type="date"
                {...register("date")}
                className="w-full px-4 py-3 bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-lg text-[var(--theme-control-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all"
              />
              {errors.date && <span className="text-[var(--theme-danger)] text-sm mt-1">{errors.date.message}</span>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="text-sm font-medium text-[var(--foreground)] flex items-center gap-2">
                <Clock className="w-4 h-4 text-[var(--theme-link)]" />
                Hora Inicio
              </label>
              <div className="relative">
                <input
                  type="time"
                  {...register("startTime")}
                  className="w-full px-4 py-3 bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-lg text-[var(--theme-control-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all"
                />
                {errors.startTime && <span className="text-[var(--theme-danger)] text-sm mt-1">{errors.startTime.message}</span>}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium text-[var(--foreground)] flex items-center gap-2">
                <Clock className="w-4 h-4 text-[var(--theme-link)]" />
                Hora Fin
              </label>
              <div className="relative">
                <input
                  type="time"
                  {...register("endTime")}
                  className="w-full px-4 py-3 bg-[var(--theme-control-bg)] border border-[var(--theme-control-border)] rounded-lg text-[var(--theme-control-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] transition-all"
                />
                {errors.endTime && <span className="text-[var(--theme-danger)] text-sm mt-1">{errors.endTime.message}</span>}
              </div>
            </div>
          </div>

          {message && (
            <div className={`p-4 rounded-lg flex items-start gap-3 mt-4 ${message.type === "success" ? "bg-emerald-500/10 border border-emerald-500/20 text-[var(--theme-success)]" : "bg-red-500/10 border border-red-500/20 text-[var(--theme-danger)]"}`}>
              {message.type === "success" ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
              <p className="text-sm font-medium">{message.text}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || livePreviewMinutes <= 0}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 px-4 rounded-lg shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-4"
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            {isSubmitting ? "Registrando..." : "Registrar Tiempo Manual"}
          </button>
        </form>

        {/* Live Preview Panel */}
        <div className="space-y-6">
          <div className="bg-[var(--theme-panel)] border border-[var(--border)] rounded-xl p-6 shadow-lg sticky top-6">
            <h3 className="text-lg font-semibold text-[var(--foreground)] mb-6 border-b border-[var(--border)] pb-3 flex items-center gap-2">
              <Clock className="w-5 h-5 text-[var(--theme-link)]" /> Vista Previa
            </h3>
            
            <div className="space-y-5">
              <div className="flex flex-col gap-1">
                <span className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider font-semibold">Intérprete</span>
                <span className="text-[var(--foreground)] font-medium truncate">
                  {selectedInterpreter ? selectedInterpreter.name : "No seleccionado"}
                </span>
              </div>
              
              <div className="flex flex-col gap-1">
                <span className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider font-semibold">Fecha</span>
                <span className="text-[var(--foreground)] font-medium">{watchDate || "--"}</span>
              </div>
              
              <div className="flex flex-col gap-1">
                <span className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider font-semibold">Horario</span>
                <span className="text-[var(--foreground)] font-medium">
                  {watchStartTime || "--"} - {watchEndTime || "--"}
                </span>
              </div>
              
              <div className="pt-4 mt-2 border-t border-[var(--border)]">
                <span className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider font-semibold block mb-2">Total a Registrar</span>
                <div className="flex items-baseline gap-2">
                  <span className={`text-5xl font-bold ${livePreviewMinutes > 0 ? "text-[var(--theme-success)]" : "text-[var(--text-tertiary)]"}`}>
                    {livePreviewMinutes}
                  </span>
                  <span className={`text-lg font-medium ${livePreviewMinutes > 0 ? "text-[var(--theme-success)]" : "text-[var(--text-tertiary)]"}`}>
                    min
                  </span>
                </div>
              </div>
              
              {livePreviewMinutes > 0 && (
                <div className="mt-6 bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-lg flex gap-3 items-start shadow-inner">
                  <CheckCircle2 className="w-5 h-5 text-[var(--theme-success)] shrink-0 mt-0.5" />
                  <p className="text-sm text-[var(--theme-success)] leading-relaxed">
                    Se enviará un registro manual a la API para <strong className="text-[var(--theme-success)]">{livePreviewMinutes} minutos</strong> de servicio.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
