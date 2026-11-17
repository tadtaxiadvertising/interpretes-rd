import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentProfile } from '@/app/actions/auth';
import { getHappyScribeSettingsStatus } from '@/lib/roleplay/happyscribe-settings';
import AudioStudioSettingsForm from './settings-form';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

export const dynamic = 'force-dynamic';
export default async function AudioStudioSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'admin') redirect('/dashboard');
  let settings: Awaited<ReturnType<typeof getHappyScribeSettingsStatus>> | null = null;
  try {
    settings = await getHappyScribeSettingsStatus();
  } catch (error) {
    console.error('[Audio Studio settings] Unable to read settings:', safeServerErrorCategory(error));
  }
  return <div className="max-w-3xl space-y-6">
    <Link href="/admin/roleplays" className="text-sm text-blue-300 hover:underline">← Volver a roleplays</Link>
    <div><h1 className="text-3xl font-bold text-white">Configuración de Audio Studio</h1>
    <p className="mt-2 text-slate-400">Administra HappyScribe y los límites de transferencia sin editar archivos del servidor.</p></div>
    {settings ? <AudioStudioSettingsForm initial={settings} /> : (
      <div role="alert" className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
        <p className="font-semibold text-amber-200">No se pudieron cargar los ajustes.</p>
        <p className="mt-2 text-sm text-slate-300">No se han modificado las credenciales. Revisa la conexión con la base de datos e inténtalo de nuevo.</p>
        <Link href="/admin/roleplays/settings" className="mt-3 inline-block text-sm text-blue-300 hover:underline">Reintentar</Link>
      </div>
    )}
  </div>;
}
