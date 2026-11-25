'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body>
        <style>{`
          body { margin: 0; min-height: 100vh; background: #f5f7fc; color: #13233b; font-family: system-ui, sans-serif; color-scheme: light; }
          .fatal-reference { color: #43546d; }
          .fatal-retry { cursor: pointer; border: 0; border-radius: 12px; background: #1554a8; color: #fff; padding: 12px 24px; font-weight: 700; }
          .fatal-retry:hover { background: #002d72; }
          .fatal-retry:focus-visible { outline: 2px solid #1554a8; outline-offset: 3px; }
          @media (prefers-color-scheme: dark) {
            body { background: #07111f; color: #f8fafc; color-scheme: dark; }
            .fatal-reference { color: #cbd5e1; }
            .fatal-retry:focus-visible { outline-color: #93c5fd; }
          }
        `}</style>
        <main style={{ maxWidth: 640, margin: '0 auto', padding: '18vh 24px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 32 }}>No se pudo iniciar la plataforma</h1>
          <p>El servidor encontró un error al cargar la aplicación. Intenta nuevamente.</p>
          {error.digest && <p className="fatal-reference" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>Referencia: {error.digest}</p>}
          <button type="button" onClick={reset} className="fatal-retry">
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
