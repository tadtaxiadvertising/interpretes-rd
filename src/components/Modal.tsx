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
  closeDisabled?: boolean;
  closeLabel?: string;
}

// An interpreter or candidate view can mount several closed Modal components.
// Only dialogs that are actually open may lock or restore body scrolling.
const openDialogIds: symbol[] = [];
let previousBodyOverflow: string | null = null;

function focusableItems(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.closest('[hidden], [inert]') && element.getAttribute('aria-hidden') !== 'true');
}

export function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-2xl', closeDisabled = false, closeLabel = 'Cerrar ventana' }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogIdRef = useRef(Symbol('modal'));
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  onCloseRef.current = () => { if (!closeDisabled) onClose(); };

  useEffect(() => {
    if (!isOpen) return;

    const dialogId = dialogIdRef.current;
    if (openDialogIds.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openDialogIds.push(dialogId);

    const handleKeydown = (event: KeyboardEvent) => {
      if (openDialogIds[openDialogIds.length - 1] !== dialogId) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = modalRef.current;
      if (!dialog) return;
      const elements = focusableItems(dialog);
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active) || (event.shiftKey && active === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      const index = openDialogIds.lastIndexOf(dialogId);
      if (index !== -1) openDialogIds.splice(index, 1);
      if (openDialogIds.length === 0) {
        document.body.style.overflow = previousBodyOverflow ?? '';
        previousBodyOverflow = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (closeButtonRef.current?.disabled) modalRef.current?.focus();
    else closeButtonRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="theme-workspace fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
        aria-hidden="true"
        onClick={() => {
          if (openDialogIds[openDialogIds.length - 1] === dialogIdRef.current) onCloseRef.current();
        }}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[calc(100dvh-1.5rem)] w-full flex-col rounded-3xl border border-[var(--border)] bg-[var(--theme-panel)] text-[var(--foreground)] shadow-2xl overflow-hidden sm:max-h-[calc(100dvh-3rem)] animate-in zoom-in-95 fade-in duration-300',
          maxWidth
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--theme-panel)] px-5 py-4 sm:px-8 sm:py-6">
          <h3 id={titleId} className="text-lg sm:text-xl font-bold text-[var(--foreground)] tracking-tight">{title}</h3>
          <button
            type="button"
            ref={closeButtonRef}
            aria-label={closeLabel}
            disabled={closeDisabled}
            onClick={() => onCloseRef.current()}
            className="theme-action-secondary shrink-0 rounded-xl p-2 transition-colors"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-8 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
