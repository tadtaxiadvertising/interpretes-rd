'use client';

import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-2xl' }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleEscape);
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="theme-workspace fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div 
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative w-full rounded-3xl border border-[var(--border)] bg-[var(--theme-panel)] text-[var(--foreground)] shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-300",
          maxWidth
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--theme-panel)] px-5 py-4 sm:px-8 sm:py-6">
          <h3 id={titleId} className="text-lg sm:text-xl font-bold text-[var(--foreground)] tracking-tight">{title}</h3>
          <button
            type="button"
            ref={closeButtonRef}
            aria-label="Cerrar ventana"
            onClick={onClose}
            className="rounded-xl p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--theme-hover)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto p-5 sm:p-8 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
