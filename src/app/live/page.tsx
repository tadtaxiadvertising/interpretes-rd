import { redirect } from 'next/navigation';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import LiveWorkspace from './LiveWorkspace';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const identity = await resolveCurrentIdentity();
  if (!identity) redirect('/login');

  return <LiveWorkspace />;
}
