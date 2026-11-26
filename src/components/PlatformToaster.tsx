'use client';

import { X } from 'lucide-react';
import { toast, ToastBar, Toaster } from 'react-hot-toast';

export default function PlatformToaster() {
  return (
    <Toaster
      position="bottom-right"
      containerClassName="platform-toaster"
      containerStyle={{
        bottom: 'var(--platform-toast-bottom)',
        left: 'max(12px, env(safe-area-inset-left))',
        right: 'max(12px, env(safe-area-inset-right))',
        top: 'max(12px, env(safe-area-inset-top))',
      }}
      toastOptions={{
        duration: 5000,
        success: { duration: 3500 },
        error: { duration: 8000, ariaProps: { role: 'alert', 'aria-live': 'assertive' } },
        style: {
          background: 'var(--theme-panel)',
          color: 'var(--foreground)',
          maxWidth: 'min(420px, 100%)',
          minWidth: 0,
          overflowWrap: 'anywhere',
          border: '1px solid var(--theme-control-border)',
          borderRadius: 12,
        },
      }}
    >
      {current => (
        <ToastBar toast={current}>
          {({ icon, message }) => (
            <>
              {icon}
              <div className="platform-toast-message min-w-0 flex-1 text-sm">{message}</div>
              {current.type !== 'loading' && (
                <button
                  type="button"
                  aria-label="Cerrar aviso"
                  className="platform-toast-close"
                  onClick={() => toast.dismiss(current.id)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}
