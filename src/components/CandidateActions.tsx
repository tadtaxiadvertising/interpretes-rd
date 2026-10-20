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
  Link2,
  Copy,
  CheckCircle2
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { deleteCandidate, hireCandidate, markApplicationReadyAction } from '@/app/actions/recruitment';
import { createRoleplaySession } from '@/app/actions/roleplay';

interface CandidateActionsProps {
  candidate: {
    id: number;
    name: string;
    email: string;
    applicationStatus?: string | null;
  };
}

const APPLICATION_READY_STATES = ['READY_FOR_ACTIVATION', 'HIRING'];
const APPLICATION_CLOSED_STATES = ['HIRED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'];

export function CandidateActions({ candidate }: CandidateActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isHiring, setIsHiring] = useState(false);
  const [isMarkingReady, setIsMarkingReady] = useState(false);
  const [isCreatingRoleplay, setIsCreatingRoleplay] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRoleplayCreated, setShowRoleplayCreated] = useState<{ link: string; candidateName: string } | null>(null);
  const router = useRouter();

  const applicationStatus = candidate.applicationStatus ?? null;
  const canMarkReady =
    applicationStatus !== null &&
    !APPLICATION_READY_STATES.includes(applicationStatus) &&
    !APPLICATION_CLOSED_STATES.includes(applicationStatus);
  // `hireCandidate` only accepts READY_FOR_ACTIVATION / HIRING, so the UI must
  // not offer hiring before the application has been marked ready.
  const canHire = applicationStatus !== null && APPLICATION_READY_STATES.includes(applicationStatus);

  const handleCreateRoleplay = async () => {
    setIsCreatingRoleplay(true);
    setIsOpen(false);
    try {
      const result = await createRoleplaySession({
        recruitmentCandidateId: candidate.id,
        baseAudioMimeType: 'audio/webm',
        baseAudioSize: 0,
      });
      
      if (!result.success) throw new Error(result.error || 'Failed to create roleplay');
      
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const inviteLink = result.data?.inviteToken 
        ? `${baseUrl}/roleplays/invite/${result.data.inviteToken}`
        : `${baseUrl}/roleplays/${result.data?.sessionId}`;
      
      setShowRoleplayCreated({ link: inviteLink, candidateName: candidate.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(error);
      alert(`Error creating roleplay: ${message}`);
    } finally {
      setIsCreatingRoleplay(false);
    }
  };

  const handleCopyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      alert('Link copied to clipboard!');
    } catch {
      alert('Failed to copy link');
    }
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
              onClick={() => setIsOpen(false)}
            >
              <Edit size={16} />
              Edit Application
            </button>
            <button 
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-white/5 flex items-center gap-3 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              <Mail size={16} />
              Send Email
            </button>
            <button 
              disabled={isCreatingRoleplay}
              className="w-full px-4 py-2 text-left text-sm text-blue-400 hover:bg-blue-500/10 flex items-center gap-3 transition-colors disabled:opacity-50"
              onClick={handleCreateRoleplay}
            >
              {isCreatingRoleplay ? <Loader2 size={16} className="animate-spin" /> : <Mic2 size={16} />}
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
                onClick={handleHire}
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

      {/* Roleplay Created Modal */}
      {showRoleplayCreated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowRoleplayCreated(null)} />
          <div className="relative bg-[#1a1a24] border border-white/10 rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-green-500/10 rounded-2xl flex items-center justify-center text-green-500 mb-6">
              <Mic2 size={32} />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Roleplay Created!</h3>
            <p className="text-gray-400 text-sm mb-6 leading-relaxed">
              Roleplay created for <span className="text-white font-bold">{showRoleplayCreated.candidateName}</span>. Share the link below:
            </p>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                value={showRoleplayCreated.link} 
                readOnly
                className="flex-1 bg-slate-950 border border-white/10 rounded-xl py-3 px-4 text-white text-sm"
              />
              <button 
                onClick={() => handleCopyLink(showRoleplayCreated.link)}
                className="px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2"
              >
                <Copy size={18} />
              </button>
            </div>
            <button 
              onClick={() => setShowRoleplayCreated(null)}
              className="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl font-bold transition-all"
            >
              Close
            </button>
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