'use client';

import { useState } from 'react';
import {
  RECRUITMENT_EMAIL_KINDS,
  recruitmentEmailTemplate,
  type RecruitmentEmailKind,
} from '@/lib/email/recruitment-templates';

export default function RecruitmentEmailPreview() {
  const [kind, setKind] = useState<RecruitmentEmailKind>('application_received');
  const template = recruitmentEmailTemplate(kind);

  return (
    <section aria-labelledby="recruitment-email-preview" className="space-y-3 border-t border-[var(--border)] pt-4">
      <h3 id="recruitment-email-preview" className="font-semibold text-[var(--foreground)]">Vista previa de correos operativos</h3>
      <p className="text-sm text-[var(--foreground)]">Ejemplos de contenido sin datos personales. No se envían correos desde esta vista.</p>
      <label className="block text-sm font-medium text-[var(--foreground)]" htmlFor="recruitment-email-kind">Tipo de comunicación</label>
      <select id="recruitment-email-kind" value={kind} onChange={(event) => {
        const selected = RECRUITMENT_EMAIL_KINDS.find((value) => value === event.target.value);
        if (selected) setKind(selected);
      }} className="w-full rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] p-3 text-sm text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2">
        {RECRUITMENT_EMAIL_KINDS.map((value) => <option key={value} value={value}>{recruitmentEmailTemplate(value).label}</option>)}
      </select>
      <div aria-live="polite" className="overflow-hidden rounded-xl border border-[var(--border)]">
        <p className="break-words border-b border-[var(--border)] p-3 text-sm text-[var(--foreground)]"><strong>Asunto:</strong> {template.subject}</p>
        <div className="border-t-4 border-[#c62828] bg-white p-5 text-[#172033]">
          <p className="font-bold text-[#163b70]">Intérpretes RD</p>
          <h4 className="mt-4 text-xl font-bold text-[#163b70]">{template.heading}</h4>
          <p className="mt-3 text-sm leading-6">{template.message}</p>
          <p className="mt-3 text-sm leading-6">{template.nextStep}</p>
          <p className="mt-5 border-t border-slate-200 pt-3 text-xs text-slate-600">Intérpretes RD · República Dominicana</p>
        </div>
      </div>
    </section>
  );
}
