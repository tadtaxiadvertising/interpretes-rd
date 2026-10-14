import type { Metadata, Viewport } from "next";
import { Toaster } from "react-hot-toast";
import "./globals.css";
import VersionGuard from "@/components/VersionGuard";

export const metadata: Metadata = {
  title: "Intérpretes RD | Plataforma de gestión y oportunidades",
  description:
    "Conoce Intérpretes RD: una plataforma para postulación de candidatos, seguimiento profesional y gestión operativa de intérpretes.",
  keywords: [
    "intérpretes",
    "postulación",
    "reclutamiento",
    "gestión de intérpretes",
    "producción",
    "Free Interpreters OS",
  ],
  authors: [{ name: "Intérpretes RD" }],
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  themeColor: "#2675ff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="antialiased font-sans selection:bg-primary selection:text-white">
        <VersionGuard />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: "rgba(15, 23, 42, 0.9)",
              color: "#fff",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "12px",
            },
          }}
        />
        <main className="relative min-h-screen">{children}</main>
      </body>
    </html>
  );
}
