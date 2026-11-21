'use server';
import { revalidatePath } from 'next/cache';
import { validateAction } from '@/lib/auth/actions';
import {
  getAudioStudioEditorPreferences, getHappyScribeSettingsStatus, saveHappyScribeSettings,
} from '@/lib/roleplay/happyscribe-settings';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

export async function saveAudioStudioSettings(form: FormData): Promise<{ success: boolean; message: string; conflict?: boolean }> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, message: 'No autorizado.' };
  const token = form.get('token');
  const organization = form.get('organizationId');
  if (typeof token !== 'string' || (organization !== null && typeof organization !== 'string'))
    return { success: false, message: 'Solicitud inválida.' };
  const excludeValue = form.get('excludeInterpreterByDefault');
  const compactValue = form.get('compactViewDefault');
  const protocolLanguageValue = form.get('protocolLanguageDefault');
  const integrationValue = form.get('integrationEnabled');
  const mediaValue = form.get('mediaImportEnabled');
  const expectedRevision = form.get('expectedRevision');
  if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision))
    return { success: false, conflict: true, message: 'La sesión de ajustes está desactualizada. Vuelve a cargar la configuración antes de guardar.' };
  if (excludeValue !== null && excludeValue !== 'true' && excludeValue !== 'false')
    return { success: false, message: 'Preferencia de intérprete no válida.' };
  if (compactValue !== null && !['auto', 'compact', 'expanded'].includes(String(compactValue)))
    return { success: false, message: 'Modo de visualización no válido.' };
  if (protocolLanguageValue !== null && protocolLanguageValue !== 'en' && protocolLanguageValue !== 'es')
    return { success: false, message: 'Idioma predeterminado del protocolo no válido.' };
  if (integrationValue !== null && integrationValue !== 'true' && integrationValue !== 'false')
    return { success: false, message: 'Estado de conexión no válido.' };
  if (mediaValue !== null && mediaValue !== 'true' && mediaValue !== 'false' && mediaValue !== 'on')
    return { success: false, message: 'Preferencia de importación MP3 no válida.' };
  try {
    await saveHappyScribeSettings({
      token,
      ...(organization !== null ? { organizationId: organization } : {}),
      ...(mediaValue !== null ? { mediaImportEnabled: mediaValue === 'true' || mediaValue === 'on' } : {}),
      removeToken: form.get('removeToken') === 'on',
      ...(integrationValue !== null ? { integrationEnabled: integrationValue === 'true' } : {}),
      updatedBy: auth.user.userId,
      expectedRevision,
      ...(excludeValue !== null ? { excludeInterpreterByDefault: excludeValue === 'true' } : {}),
      ...(compactValue !== null ? { compactViewDefault: compactValue as 'auto' | 'compact' | 'expanded' } : {}),
      ...(protocolLanguageValue !== null ? { protocolLanguageDefault: protocolLanguageValue as 'en' | 'es' } : {}),
    });
    // The encrypted settings transaction has committed. Cache revalidation
    // cannot undo it and must not trick an admin into resubmitting a secret.
    try {
      revalidatePath('/admin/roleplays/settings');
    } catch {
      console.warn('[Audio Studio settings] Saved; cache refresh failed');
    }
    return { success: true, message: 'Configuración guardada. Las credenciales permanecen ocultas.' };
  } catch (error) {
    // Only classify exact, documented codes. Arbitrary error messages, Prisma
    // metadata, provider tokens and stack traces must never enter logs or UI.
    const code = error && typeof error === 'object' && 'code' in error &&
      typeof error.code === 'string' ? error.code
      : error instanceof Error ? error.message : '';
    if (code === 'SETTINGS_CONFLICT' || code === 'P2034') {
      return {
        success: false,
        conflict: true,
        message: 'Otro administrador modificó estos ajustes. No se guardaron tus cambios; revisa y carga la versión actual antes de volver a guardar.',
      };
    }
    if (code === 'ENCRYPTION_KEY_MISSING') {
      // This is an expected configuration guard, not an unknown server error.
      // Do not log it as the opaque "[Audio Studio settings] Error".
      return { success: false, message:
        'Falta AUDIO_STUDIO_ENCRYPTION_KEY (64 caracteres hexadecimales) en el servicio Next.js. Si ya existe una credencial cifrada, restaura la clave original en Easypanel antes de intentar guardarla.' };
    }
    if (code === 'ORGANIZATION_INVALID') {
      return { success: false, message: 'El ID de organización debe contener solo números.' };
    }
    if (code === 'TOKEN_INVALID') {
      return { success: false, message: 'La clave API no tiene un formato válido.' };
    }
    if (code === 'TOKEN_OPERATION_CONFLICT') {
      return { success: false, message: 'No puedes borrar y reemplazar la clave al mismo tiempo.' };
    }
    if (code === 'P2021' || code === 'P2022') {
      console.warn('[Audio Studio settings] Database schema unavailable');
      return { success: false, message:
        'La estructura de configuración de la base de datos no está lista. Verifica el esquema y las migraciones con el procedimiento seguro de despliegue. No se han guardado estos cambios.' };
    }
    if (code === 'P1001' || code === 'P1002' || code === 'P1003') {
      console.warn('[Audio Studio settings] Database connection unavailable');
      return { success: false, message:
        'No se pudo conectar con la base de datos de configuración. Comprueba el estado de PostgreSQL e inténtalo más tarde. No se han guardado estos cambios.' };
    }
    console.error('[Audio Studio settings] Unexpected save failure:', safeServerErrorCategory(error));
    return { success: false, message:
      'No se pudieron guardar los cambios. Revisa los servicios de aplicación y base de datos; no vuelvas a enviar una clave API hasta comprobar el estado de la configuración.' };
  }
}

export async function inspectAudioStudioSettings() {
  const auth = await validateAction('admin');
  if ('error' in auth) throw new Error('Forbidden');
  return getHappyScribeSettingsStatus();
}

/** Read only safe editor defaults. Never return provider tokens or ciphertext. */
export async function readAudioStudioEditorPreferences() {
  const auth = await validateAction('admin');
  if ('error' in auth) throw new Error('Forbidden');
  return getAudioStudioEditorPreferences();
}
