import React from 'react';
import { CSVImporter } from '@/components/CSVImporter';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function ImportPage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex items-center gap-4 flex-wrap">
        <Link 
          href="/settings" 
          aria-label="Volver a configuración"
          className="theme-action-secondary p-2 rounded-xl transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)]">Migración de datos</h2>
          <p className="text-[var(--text-secondary)]">Importa tus archivos CSV anteriores a Intérpretes RD</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <CSVImporter 
          type="interpreters"
          title="Directorio de intérpretes"
          description="Importa el listado de intérpretes. Columnas: ID, Name, Status, Tariff."
        />
        
        <CSVImporter 
          type="production"
          title="Registros de producción"
          description="Importa registros diarios. Columnas: Date, Interpreter, Minutes, Adherence."
        />

        <div className="lg:col-span-2 p-5 sm:p-8 rounded-3xl border border-[var(--border)] bg-[var(--theme-panel)]">
          <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6">
            <div className="p-4 bg-[var(--theme-surface-muted)] rounded-2xl text-[var(--theme-link)] border border-[var(--border)]">
              <FileSpreadsheet size={32} />
            </div>
            <div>
              <h4 className="text-lg font-bold text-[var(--foreground)]">Recomendaciones de importación</h4>
              <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-2xl">
                Usa los encabezados indicados y archivos con codificación UTF-8. Los intérpretes existentes se actualizan; los nuevos se crean. Los registros de producción <strong>se añaden</strong>: revisa los resultados antes de repetir una importación.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <span className="text-[10px] font-bold bg-[var(--theme-surface-muted)] text-[var(--text-secondary)] px-2 py-1 rounded-md border border-[var(--border)] uppercase">Codificación UTF-8</span>
                <span className="text-[10px] font-bold bg-[var(--theme-surface-muted)] text-[var(--text-secondary)] px-2 py-1 rounded-md border border-[var(--border)] uppercase">Sin filas vacías</span>
                <span className="text-[10px] font-bold bg-[var(--theme-surface-muted)] text-[var(--text-secondary)] px-2 py-1 rounded-md border border-[var(--border)] uppercase">Encabezados requeridos</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
