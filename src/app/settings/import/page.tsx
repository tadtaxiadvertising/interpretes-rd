import React from 'react';
import { CSVImporter } from '@/components/CSVImporter';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function ImportPage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex items-center gap-4">
        <Link 
          href="/settings" 
          className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all border border-white/5"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h2 className="text-3xl font-bold text-white">Data Migration</h2>
          <p className="text-gray-400">Import your legacy CSV files into Intérpretes RD</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <CSVImporter 
          type="interpreters"
          title="Interpreters Roster"
          description="Import your master list of interpreters. Fields: ID, Name, Status, Tariff."
        />
        
        <CSVImporter 
          type="production"
          title="Production Records"
          description="Import daily activity logs. Fields: Date, Interpreter, Minutes, Adherence."
        />

        <div className="lg:col-span-2 glass p-8 rounded-3xl border border-white/5 bg-gradient-to-br from-blue-600/5 to-transparent">
          <div className="flex items-start gap-6">
            <div className="p-4 bg-blue-500/10 rounded-2xl text-blue-400 border border-white/5">
              <FileSpreadsheet size={32} />
            </div>
            <div>
              <h4 className="text-lg font-bold text-white">Import Guidelines</h4>
              <p className="text-sm text-gray-400 mt-2 max-w-2xl">
                The platform automatically detects column headers. For best results, ensure your CSV files use standard UTF-8 encoding. 
                Interpreter imports will perform an <strong>upsert</strong> (update existing or create new). Production logs are always <strong>appended</strong>.
              </p>
              <div className="mt-6 flex gap-3">
                <span className="text-[10px] font-bold bg-white/5 text-gray-500 px-2 py-1 rounded-md border border-white/5 uppercase">UTF-8 Encoding</span>
                <span className="text-[10px] font-bold bg-white/5 text-gray-500 px-2 py-1 rounded-md border border-white/5 uppercase">No Empty Rows</span>
                <span className="text-[10px] font-bold bg-white/5 text-gray-500 px-2 py-1 rounded-md border border-white/5 uppercase">Header Required</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
