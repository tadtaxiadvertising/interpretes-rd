import type { NextConfig } from "next";

/**
 * NEXT.JS CONFIG — INTERPRETERS-API (Backend)
 * ============================================================
 * CORS: Permite solicitudes exclusivamente desde el Frontend.
 * Security: Headers de seguridad enterprise (CSP, HSTS, X-Frame).
 * Performance: Standalone output para contenedores Docker mínimos.
 * 
 * NOTA: FRONTEND_ORIGIN debe ser la URL exacta del frontend en producción.
 * En Easypanel, configúrala como variable de entorno.
 * ============================================================
 */

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://app.freeinterpreters.com";
const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN || "https://freeinterpreters.com";
const CUSTOM_DOMAIN_API = process.env.CUSTOM_DOMAIN_API || "https://freeinterpreters.com";

const nextConfig: NextConfig = {
  output: 'standalone',

  // Prisma debe ser external para evitar bundling en el serverless edge
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'prisma', 'pg', 'bcryptjs'],

  // Asegurar que los archivos del engine de Prisma se copien en el build standalone
  outputFileTracingIncludes: {
    '/': ['./prisma/**/*'],
  },

  /**
   * CORS + SECURITY HEADERS
   * --------------------------------------------------------
   * Aplicados a nivel de Next.js para TODAS las respuestas.
   * Los headers CORS en /api/* son el primer escudo; el middleware
   * maneja el preflight OPTIONS explícitamente.
   */
  async headers() {
    return [
      {
        // CORS headers para assets estáticos (fuentes, imágenes)
        source: '/_next/static/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS' },
        ],
      },
      {
        // CORS headers para API routes — restrictivo al frontend
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: FRONTEND_ORIGIN },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-Requested-With' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
      {
        // Security headers para todas las páginas
        source: '/:path*',
        headers: [
          { key: 'X-Powered-By', value: '' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self' https://kzbkygppplknynrwmtmf.supabase.co wss://kzbkygppplknynrwmtmf.supabase.co https://freeinterpreters.com https://app.freeinterpreters.com ${CUSTOM_DOMAIN} ${CUSTOM_DOMAIN_API}",
              "media-src 'self' https://kzbkygppplknynrwmtmf.supabase.co blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self' https://app.freeinterpreters.com https://freeinterpreters.com ${CUSTOM_DOMAIN} ${CUSTOM_DOMAIN_API}",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
