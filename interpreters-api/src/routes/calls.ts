import { Router } from 'express';

const router = Router();

/**
 * Retired external manual-call writer. The previous shared-secret route
 * could create a session without its ledger, mutate finalized production,
 * lose concurrent increments, or leave partial writes after an error.
 *
 * This public retirement notice is identical for every caller, does not
 * inspect credentials or payloads, and has no database dependencies.
 * Do not automatically forward old submissions to Next.js Quick Log:
 * the supported workflows use different actor and accounting contracts.
 */
router.post('/manual', (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(410).json({
    success: false,
    code: 'LEGACY_MANUAL_CALL_DISABLED',
    error: 'Utiliza el flujo autorizado de registro de llamadas de la plataforma.',
  });
});

export default router;
