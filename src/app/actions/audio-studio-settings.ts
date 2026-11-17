'use server';
import { revalidatePath } from 'next/cache';
import { validateAction } from '@/lib/auth/actions';
import { getHappyScribeSettingsStatus, saveHappyScribeSettings } from '@/lib/roleplay/happyscribe-settings';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

export async function saveAudioStudioSettings(form: FormData): Promise<{ success: boolean; message: string }> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, message: 'No autorizado.' };
  const token = form.get('token');
  const organization = form.get('organizationId');
  if (typeof token !== 'string' || typeof organization !== 'string')
    return { success: false, message: 'Solicitud inválida.' };
  try {
    await saveHappyScribeSettings({
      token, organizationId: organization,
      mediaImportEnabled: form.get('mediaImportEnabled') === 'on',
      removeToken: form.get('removeToken') === 'on',
    });
    revalidatePath('/admin/roleplays/settings');
    return { success: true, message: 'Configuración guardada. Las credenciales permanecen ocultas.' };
  } catch (error) {
    console.error('[Audio Studio settings]', safeServerErrorCategory(error));
    const code = error instanceof Error ? error.message : '';
    return { success: false, message: code === 'ENCRYPTION_KEY_MISSING'
      ? 'Falta AUDIO_STUDIO_ENCRYPTION_KEY (64 caracteres hexadecimales) en el servidor.'
      : code === 'ORGANIZATION_INVALID' ? 'El ID de organización debe contener solo números.'
      : code === 'TOKEN_INVALID' ? 'La clave API no tiene un formato válido.'
      : 'No se pudieron guardar los cambios.' };
  }
}

export async function inspectAudioStudioSettings() {
  const auth = await validateAction('admin');
  if ('error' in auth) throw new Error('Forbidden');
  return getHappyScribeSettingsStatus();
}
