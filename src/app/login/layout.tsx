import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Iniciar sesión | Intérpretes RD',
  description: 'Acceso seguro a la plataforma de gestión de Intérpretes RD',
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    // Login has its own full-screen layout — no sidebar
    <>{children}</>
  );
}
