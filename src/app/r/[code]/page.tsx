import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Invitación de Roleplay',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ code: string }>;
}

/**
 * Public short links never query invitation records or reveal their status.
 * The destination validates authentication, invitation ownership and state
 * before binding a session cookie or providing any audio URLs.
 */
export default async function ShortInviteRedirect({ params }: PageProps) {
  const { code } = await params;

  // Only reject invalid syntax here, never reveal whether a valid-looking
  // invitation exists, expired, was consumed or belongs to another user.
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(code)) notFound();

  redirect(`/roleplays/invite-by-code/${code.toUpperCase()}`);
}
