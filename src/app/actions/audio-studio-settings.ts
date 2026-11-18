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
    console.error('[Audio Studio settings]', safeServerErrorCategory(error));
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : error instanceof Error ? error.message : '';
    if (code === 'SETTINGS_CONFLICT' || code === 'P2034') {
      return {
        success: false,
        conflict: true,
        message: 'Otro administrador modificó estos ajustes. No se guardaron tus cambios; revisa y carga la versión actual antes de volver a guardar.',
      };
    }
    return { success: false, message: code === 'ENCRYPTION_KEY_MISSING'
      ? 'Falta AUDIO_STUDIO_ENCRYPTION_KEY (64 caracteres hexadecimales) en el servidor.'
      : code === 'ORGANIZATION_INVALID' ? 'El ID de organización debe contener solo números.'
      : code === 'TOKEN_INVALID' ? 'La clave API no tiene un formato válido.'
      : code === 'TOKEN_OPERATION_CONFLICT' ? 'No puedes borrar y reemplazar la clave al mismo tiempo.'
      : 'No se pudieron guardar los cambios.' };
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
