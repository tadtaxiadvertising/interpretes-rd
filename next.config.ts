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

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://interpretes.rd.ibusiness.com.do";
const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN || "https://interpretes.rd.ibusiness.com.do";
const CUSTOM_DOMAIN_API = process.env.CUSTOM_DOMAIN_API || "https://interpretes.rd.ibusiness.com.do";

const nextConfig: NextConfig = {
  output: 'standalone',

  // Prisma debe ser external para evitar bundling en el serverless edge
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'prisma', 'pg', 'bcryptjs', 'ffmpeg-static'],

  // Asegurar que los archivos del engine de Prisma se copien en el build standalone
  outputFileTracingIncludes: {
    '/': ['./prisma/**/*'],
    // ffmpeg-static resolves its executable from a runtime filesystem path.
    // Next standalone tracing may omit that binary without an explicit include.
    '/api/admin/roleplays/studio/export': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/admin/roleplays/studio/silences': ['./node_modules/ffmpeg-static/ffmpeg'],
  },

  /**
   * CORS + SECURITY HEADERS
   * --------------------------------------------------------
   * Aplicados a nivel de Next.js para TODAS las respuestas.
   * Los headers CORS en /api/* son el primer escudo; el middleware
   * maneja el preflight OPTIONS explícitamente.
   */
  async headers() {
    const baseCsp = [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self' https://kzbkygppplknynrwmtmf.supabase.co wss://kzbkygppplknynrwmtmf.supabase.co https://interpretes.rd.ibusiness.com.do https://interpretes.rd.ibusiness.com.do ${CUSTOM_DOMAIN} ${CUSTOM_DOMAIN_API}",
              "media-src 'self' https://kzbkygppplknynrwmtmf.supabase.co blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self' https://interpretes.rd.ibusiness.com.do https://interpretes.rd.ibusiness.com.do ${CUSTOM_DOMAIN} ${CUSTOM_DOMAIN_API}",
            ].join('; ');

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
            value: baseCsp,
          },
        ],
      },
      // The model is fetched *inside the dedicated Whisper Worker*, not by the
      // document. Keep /live itself on the unmodified site CSP, even when the
      // experimental build flag is enabled. See MDN: CSP in Workers.
      // Only an explicitly enabled experimental build can expand network hosts
      // for bundled Worker scripts. Do not enable for general production use.
      ...(process.env.NEXT_PUBLIC_LIVE_WHISPER_PILOT_ENABLED === 'true'
        ? [
            {
              // Only the named Whisper Worker receives model-download rights.
              // The app's normal page bundles, unrelated Workers, and /live
              // itself retain the restrictive global CSP.
              // CI proves the named output bundle exists when pilot is built.
              source: '/_next/static/chunks/live-whisper-asr-worker.:hash([a-f0-9]+).js',
              headers: [{
                key: 'Content-Security-Policy',
                value: baseCsp.replace(
                  "connect-src 'self'",
                  "connect-src 'self' https://huggingface.co https://cdn-lfs.hf.co https://us.aws.cdn.hf.co https://cas-bridge.xethub.hf.co https://cas-server.xethub.hf.co",
                ),
              }],
            },
          ]
        : []),
    ];
  },
};

export default nextConfig;
