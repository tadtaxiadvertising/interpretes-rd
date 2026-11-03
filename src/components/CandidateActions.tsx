'use client';

import React, { useState } from 'react';
import { 
  MoreVertical, 
  Edit, 
  Trash2, 
  UserPlus,
  Loader2,
  AlertTriangle,
  Mail,
  Mic2,
  CheckCircle2,
  X
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { deleteCandidate, hireCandidate, markApplicationReadyAction, updateRecruitmentCandidateAction } from '@/app/actions/recruitment';

interface CandidateActionsProps {
  candidate: {
    id: number;
    name: string;
    email: string;
    applicationStatus?: string | null;
    telefono?: string | null;
    pais?: string | null;
    englishLevel?: string | null;
    speedtestMbps?: number | null;
    notas?: string | null;
  };
}

const APPLICATION_READY_STATES = ['READY_FOR_ACTIVATION', 'HIRING'];
const APPLICATION_CLOSED_STATES = ['HIRED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'];

export function CandidateActions({ candidate }: CandidateActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isHiring, setIsHiring] = useState(false);
  const [isMarkingReady, setIsMarkingReady] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showHireConfirm, setShowHireConfirm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [emailSubject, setEmailSubject] = useState('Seguimiento de tu postulación');
  const [emailMessage, setEmailMessage] = useState('');
  const [editForm, setEditForm] = useState(() => {
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = candidate.notas ? JSON.parse(candidate.notas) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed;
    } catch { /* Preserve legacy notes server-side; links start empty. */ }
    return {
      name: candidate.name,
      email: candidate.email,
      telefono: candidate.telefono ?? '',
      pais: candidate.pais ?? '',
      englishLevel: candidate.englishLevel ?? 'B2',
      speedtestMbps: candidate.speedtestMbps?.toString() ?? '',
      efsetLink: typeof metadata.efsetLink === 'string' ? metadata.efsetLink : '',
      cvUrl: typeof metadata.cvUrl === 'string' ? metadata.cvUrl : '',
    };
  });
  const router = useRouter();

  const applicationStatus = candidate.applicationStatus ?? null;
  const canMarkReady =
    applicationStatus !== null &&
    !APPLICATION_READY_STATES.includes(applicationStatus) &&
    !APPLICATION_CLOSED_STATES.includes(applicationStatus);
  // `hireCandidate` only accepts READY_FOR_ACTIVATION / HIRING, so the UI must
  // not offer hiring before the application has been marked ready.
  const canHire = applicationStatus !== null && APPLICATION_READY_STATES.includes(applicationStatus);

  const handleSaveCandidate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setEditError(null);
    try {
      const result = await updateRecruitmentCandidateAction({
        id: candidate.id,
        ...editForm,
        speedtestMbps: editForm.speedtestMbps ? Number(editForm.speedtestMbps) : null,
        telefono: editForm.telefono || null,
        pais: editForm.pais || null,
      });
      if (!result.success) throw new Error(result.error || 'No se pudieron guardar los cambios.');
      setShowEdit(false);
      router.refresh();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'No se pudieron guardar los cambios.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenEmail = () => {
    setIsOpen(false);
    setShowEmail(true);
  };

  const handleComposeEmail = () => {
    const mailto = 'mailto:' + encodeURIComponent(candidate.email)
      + '?subject=' + encodeURIComponent(emailSubject)
      + '&body=' + encodeURIComponent(emailMessage);
    window.location.href = mailto;
    setShowEmail(false);
  };

  const handleCreateRoleplay = () => {
    setIsOpen(false);
    router.push(`/admin/roleplays/new?candidateId=${candidate.id}`);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteCandidate(candidate.id);
      if (!result.success) throw new Error(result.error);
      
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(error);
      alert(`Error deleting candidate: ${message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleHire = async () => {
    setIsHiring(true);
    try {
      const result = await hireCandidate(candidate.id);
      if (!result.success) throw new Error(result.error);
      
      alert(`Candidate ${candidate.name} marked as hired!`);
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Error hiring candidate: ${message}`);
    } finally {
      setIsHiring(false);
    }
  };

  const handleMarkReady = async () => {
    setIsMarkingReady(true);
    try {
      const result = await markApplicationReadyAction(candidate.id);
      if (!result.success) throw new Error(result.error);

      setIsOpen(false);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Error marking application ready: ${message}`);
    } finally {
      setIsMarkingReady(false);
    }
  };


  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "p-2 hover:bg-white/10 rounded-xl transition-colors",
          isOpen ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
        )}
      >
        <MoreVertical size={20} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 mt-2 w-52 bg-[#1a1a24] border border-white/10 rounded-2xl shadow-2xl z-20 py-2 animate-in fade-in zoom-in-95 duration-200">
            <button 
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-white/5 flex items-center gap-3 transition-colors"
              onClick={() => { setIsOpen(false); setEditError(null); setShowEdit(true); }}
            >
              <Edit size={16} />
              Edit Application
            </button>
            <button 
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-white/5 flex items-center gap-3 transition-colors"
              onClick={handleOpenEmail}
            >
              <Mail size={16} />
              Send Email
            </button>
            <button 
              className="w-full px-4 py-2 text-left text-sm text-blue-400 hover:bg-blue-500/10 flex items-center gap-3 transition-colors"
              onClick={handleCreateRoleplay}
            >
              <Mic2 size={16} />
              Create Roleplay
            </button>
            {canMarkReady && (
              <button
                disabled={isMarkingReady}
                className="w-full px-4 py-2 text-left text-sm text-amber-400 hover:bg-amber-500/10 flex items-center gap-3 transition-colors disabled:opacity-50"
                onClick={handleMarkReady}
              >
                {isMarkingReady ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Mark Ready for Hiring
              </button>
            )}
            {canHire && (
              <button 
                disabled={isHiring}
                className="w-full px-4 py-2 text-left text-sm text-green-400 hover:bg-green-500/10 flex items-center gap-3 transition-colors disabled:opacity-50"
                onClick={() => { setShowHireConfirm(true); setIsOpen(false); }}
              >
                {isHiring ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                Hire Candidate
              </button>
            )}
            <div className="h-px bg-white/5 my-1" />
            <button 
              className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-3 transition-colors"
              onClick={() => {
                setShowDeleteConfirm(true);
                setIsOpen(false);
              }}
            >
              <Trash2 size={16} />
              Remove Candidate
            </button>
          </div>
        </>
      )}


      {showHireConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowHireConfirm(false)} />
          <div className="relative w-full max-w-md space-y-5 rounded-3xl border border-white/10 bg-[#1a1a24] p-7 shadow-2xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/10 text-green-400"><UserPlus size={28}/></div>
            <div><h3 className="text-xl font-bold text-white">Confirm hiring</h3><p className="mt-2 text-sm leading-relaxed text-gray-400">This will promote <strong className="text-white">{candidate.name}</strong> to an active interpreter, link their account and mark the recruitment application as hired. This action changes operational access.</p></div>
            <div className="flex justify-end gap-3"><button onClick={() => setShowHireConfirm(false)} className="rounded-xl bg-white/5 px-4 py-2.5 text-gray-300">Cancel</button><button disabled={isHiring} onClick={async () => { await handleHire(); setShowHireConfirm(false); }} className="flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">{isHiring && <Loader2 size={16} className="animate-spin"/>}Confirm hiring</button></div>
          </div>
        </div>
      )}

      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
          <button aria-label="Close edit dialog" className="absolute inset-0 bg-black/70" onClick={() => setShowEdit(false)} />
          <form onSubmit={handleSaveCandidate} className="relative my-8 w-full max-w-2xl space-y-5 rounded-3xl border border-white/10 bg-[#1a1a24] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div><h3 className="text-xl font-bold text-white">Edit application</h3><p className="text-sm text-gray-400">Update candidate profile details.</p></div>
              <button type="button" onClick={() => setShowEdit(false)} className="rounded-lg p-2 text-gray-400 hover:bg-white/10"><X size={18}/></button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {([
                ['name','Full name'],['email','Email'],['telefono','Phone / WhatsApp'],['pais','Country'],['speedtestMbps','Internet speed (Mbps)'],['efsetLink','EF SET URL'],['cvUrl','CV URL']
              ] as const).map(([key,label]) => (
                <label key={key} className="space-y-1 text-sm text-gray-300">
                  <span>{label}</span>
                  <input type={key === 'email' ? 'email' : key === 'speedtestMbps' ? 'number' : key.endsWith('Url') || key === 'efsetLink' ? 'url' : 'text'}
                    min={key === 'speedtestMbps' ? 1 : undefined}
                    value={editForm[key]}
                    onChange={(event) => setEditForm((prev) => ({...prev,[key]:event.target.value}))}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-blue-500"
                  />
                </label>
              ))}
              <label className="space-y-1 text-sm text-gray-300">
                <span>English level</span>
                <select value={editForm.englishLevel} onChange={(event) => setEditForm((prev) => ({...prev,englishLevel:event.target.value}))} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-white">
                  {['B1','B2','C1','C2'].map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
            </div>
            {editError && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{editError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowEdit(false)} className="rounded-xl bg-white/5 px-4 py-2.5 text-gray-300">Cancel</button>
              <button disabled={isSaving} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">{isSaving && <Loader2 size={16} className="animate-spin"/>}Save changes</button>
            </div>
          </form>
        </div>
      )}

      {showEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Close email dialog" className="absolute inset-0 bg-black/70" onClick={() => setShowEmail(false)} />
          <div className="relative w-full max-w-lg space-y-4 rounded-3xl border border-white/10 bg-[#1a1a24] p-6 shadow-2xl">
            <div className="flex items-center justify-between"><div><h3 className="text-xl font-bold text-white">Message candidate</h3><p className="text-sm text-gray-400">To: {candidate.email}</p></div><button onClick={() => setShowEmail(false)} className="rounded-lg p-2 text-gray-400 hover:bg-white/10"><X size={18}/></button></div>
            <label className="block space-y-1 text-sm text-gray-300">Subject<input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-white"/></label>
            <label className="block space-y-1 text-sm text-gray-300">Message<textarea rows={6} value={emailMessage} onChange={(event) => setEmailMessage(event.target.value)} placeholder="Write your message..." className="w-full resize-y rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-white"/></label>
            <p className="text-xs text-amber-300">Your configured email application will open with this message ready. Sending is completed from that application.</p>
            <div className="flex justify-end gap-3"><button onClick={() => setShowEmail(false)} className="rounded-xl bg-white/5 px-4 py-2.5 text-gray-300">Cancel</button><button disabled={!emailSubject.trim() || !emailMessage.trim()} onClick={handleComposeEmail} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50"><Mail size={16}/>Open email app</button></div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-[#1a1a24] border border-white/10 rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mb-6">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Remove Candidate?</h3>
            <p className="text-gray-400 text-sm mb-8 leading-relaxed">
              Are you sure you want to remove <span className="text-white font-bold">{candidate.name}</span>? This action will delete all interview notes and history.
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl font-bold transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2"
              >
                {isDeleting ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}