import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentProfile } from '@/app/actions/auth';
import { getHappyScribeSettingsStatus } from '@/lib/roleplay/happyscribe-settings';
import AudioStudioSettingsForm from './settings-form';

export const dynamic = 'force-dynamic';
export default async function AudioStudioSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'admin') redirect('/dashboard');
  const settings = await getHappyScribeSettingsStatus();
  return <div className="max-w-3xl space-y-6">
    <Link href="/admin/roleplays" className="text-sm text-blue-300 hover:underline">← Volver a roleplays</Link>
    <div><h1 className="text-3xl font-bold text-white">Configuración de Audio Studio</h1>
    <p className="mt-2 text-slate-400">Administra HappyScribe y los límites de transferencia sin editar archivos del servidor.</p></div>
    <AudioStudioSettingsForm initial={settings} />
  </div>;
}
