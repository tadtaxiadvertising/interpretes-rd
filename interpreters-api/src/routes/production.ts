import { Router } from 'express';
import { authGuard, authorize } from '../middlewares/auth.middleware.js';

const router = Router();

/**
 * Retired legacy production writer. It accepted arbitrary interpreter IDs,
 * lacked authorization and could increment settled or finalized production.
 * Do not delegate automatically: the supported production workflows have
 * different actor, ledger, date and financial-lock semantics.
 */
router.post('/manual-entry', authGuard, authorize('ADMIN'), (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(410).json({
    success: false,
    code: 'LEGACY_PRODUCTION_ENTRY_DISABLED',
    error: 'Utiliza el flujo autorizado de registro de producción de la plataforma.',
  });
});

export default router;
