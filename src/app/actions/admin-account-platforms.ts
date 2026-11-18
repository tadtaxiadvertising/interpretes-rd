'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma, { getRawPool } from '@/lib/prisma';
import { inspectAccountVpnSchema } from '@/lib/account-vpn-schema-readiness';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isIP } from 'node:net';
import { safeHttpsUrl, rejectCredentialLikeText } from '@/lib/platform-input-security';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const optionalText = (max: number) => z.string().trim().max(max).refine(rejectCredentialLikeText);

const schema = z.object({
  accountId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  loginUrl: safeHttpsUrl,
  usernameHint: optionalText(150),
  secretRef: z.union([z.literal(''), z.string().trim().regex(/^vault:\/\/[a-zA-Z0-9/_-]{3,200}$/)]),
  vpnProvider: optionalText(120),
  vpnApp: optionalText(120),
  vpnUsernameHint: optionalText(150),
  vpnSecretRef: z.union([z.literal(''), z.string().trim().regex(/^vault:\/\/[a-zA-Z0-9/_-]{3,200}$/)]),
  vpnCountry: optionalText(80),
  vpnRegion: optionalText(100),
  vpnServer: optionalText(255),
  vpnExitIp: z.string().trim().max(45).refine(value => !value || isIP(value) !== 0, 'La IP de salida no es válida.').refine(rejectCredentialLikeText),
  vpnProfile: optionalText(100),
  vpnProtocol: optionalText(40),
  vpnPort: z.union([z.literal(''), z.coerce.number().int().min(1).max(65535)]),
  notes: z.string().trim().max(500).refine(rejectCredentialLikeText),
});

export async function createAccountPlatform(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'No autorizado.' };

  const keys = [
    'accountId', 'name', 'loginUrl', 'usernameHint', 'secretRef',
    'vpnProvider', 'vpnApp', 'vpnUsernameHint', 'vpnSecretRef',
    'vpnCountry', 'vpnRegion', 'vpnServer', 'vpnExitIp',
    'vpnProfile', 'vpnProtocol', 'vpnPort', 'notes',
  ];
  const parsed = schema.safeParse(Object.fromEntries(keys.map(key => [key, formData.get(key) ?? ''])));
  if (!parsed.success) return { success: false, error: 'Datos inválidos. Revisa la URL HTTPS, las referencias vault:// y el puerto VPN (1–65535).' };

  try {
    // The UI may be stale (or this server action called directly) while the
    // additive VPN migration is pending. Fail closed before attempting a write.
    const vpnSchemaStatus = await inspectAccountVpnSchema(getRawPool());
    if (vpnSchemaStatus !== 'complete') {
      return { success: false, error: 'La configuración VPN está temporalmente no disponible. Contacta al administrador de despliegue.' };
    }

    const {
      accountId, name, loginUrl, usernameHint, secretRef,
      vpnProvider, vpnApp, vpnUsernameHint, vpnSecretRef,
      vpnCountry, vpnRegion, vpnServer, vpnExitIp,
      vpnProfile, vpnProtocol, vpnPort, notes,
    } = parsed.data;

    await prisma.accountPlatform.create({
      data: {
        accountId,
        name,
        loginUrl: loginUrl || null,
        usernameHint: usernameHint || null,
        secretRef: secretRef || null,
        vpnProvider: vpnProvider || null,
        vpnApp: vpnApp || null,
        vpnUsernameHint: vpnUsernameHint || null,
        vpnSecretRef: vpnSecretRef || null,
        vpnCountry: vpnCountry || null,
        vpnRegion: vpnRegion || null,
        vpnServer: vpnServer || null,
        vpnExitIp: vpnExitIp || null,
        vpnProfile: vpnProfile || null,
        vpnProtocol: vpnProtocol || null,
        vpnPort: vpnPort === '' ? null : vpnPort,
        notes: notes || null,
      },
      // Only the generated ID is needed; do not return VPN or secret columns.
      select: { id: true },
    });

    // The database write already committed. Cache invalidation must not
    // report a false save failure that causes duplicate account-platform rows.
    for (const path of ['/admin/platforms', '/admin/accounts']) {
      try {
        revalidatePath(path);
      } catch (cacheError) {
        console.warn('[PLATFORMS] Saved but cache refresh failed:', safeServerErrorCategory(cacheError));
      }
    }
    return { success: true };
  } catch (error) {
    // Provider errors may contain DB connection strings or account metadata.
    console.error('[PLATFORMS] Create failed:', safeServerErrorCategory(error));
    return { success: false, error: 'No se pudo registrar la plataforma. Comprueba la cuenta y el nombre.' };
  }
}
