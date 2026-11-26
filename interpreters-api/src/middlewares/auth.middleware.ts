import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export interface AuthRequest extends Request {
  user?: any;
}

export const authGuard = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Acceso denegado: Token no proporcionado' });
    return;
  }

  const token = authHeader.split(' ')[1];
  let decoded: string | jwt.JwtPayload;
  try {
    // This service issues HS256 tokens; do not accept other algorithms.
    decoded = jwt.verify(token, ENV.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    res.status(401).json({ success: false, error: 'Acceso denegado: Token inválido o expirado' });
    return;
  }

  if (typeof decoded !== 'object' || typeof decoded.id !== 'string' ||
      !decoded.id.trim() || decoded.id.length > 128 ||
      typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp)) {
    res.status(401).json({ success: false, error: 'Acceso denegado: Token inválido o expirado' });
    return;
  }

  // Resolve only by the immutable local RBAC ID, never by an email claim.
  // Do not grant permissions using a stale token if the DB cannot be read.
  const user = await prisma.rbacUser.findUnique({
    where: { id: decoded.id },
    select: { id: true, email: true, role: true },
  });
  // A changed role invalidates existing tokens in either direction; a new
  // login is required before a promotion can grant additional privileges.
  if (!user || user.role !== decoded.role || user.email !== decoded.email) {
    res.status(401).json({ success: false, error: 'Acceso denegado: Token inválido o expirado' });
    return;
  }

  (req as AuthRequest).user = {
    id: user.id,
    email: user.email,
    role: user.role,
    iat: decoded.iat,
    exp: decoded.exp,
  };
  next();
});

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    if (!authReq.user || !roles.includes(authReq.user.role)) {
      return res.status(403).json({ success: false, error: 'Permisos insuficientes: Se requiere rol de ' + roles.join('/') });
    }
    next();
  };
};
