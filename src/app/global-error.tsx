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
      <body style={{ margin: 0, minHeight: '100vh', background: '#07111f', color: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ maxWidth: 640, margin: '0 auto', padding: '18vh 24px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 32 }}>No se pudo iniciar la plataforma</h1>
          <p>El servidor encontró un error al cargar la aplicación. Intenta nuevamente.</p>
          {error.digest && <p style={{ fontSize: 12, opacity: 0.8 }}>Referencia: {error.digest}</p>}
          <button type="button" onClick={reset} style={{ cursor: 'pointer', border: 0, borderRadius: 12, background: '#2675ff', color: '#fff', padding: '12px 24px', fontWeight: 700 }}>
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
