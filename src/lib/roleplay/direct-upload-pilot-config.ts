type Environment = Readonly<Record<string, string | undefined>>;

export const OPENING_ASSIGNMENT_FLAGS = [
  'ROLEPLAY_BILINGUAL_OPENING_API_ENABLED',
  'ROLEPLAY_BILINGUAL_OPENING_UI_ENABLED',
  'ROLEPLAY_BILINGUAL_OPENING_ASSIGNMENT_ENABLED',
] as const;

export const DIRECT_UPLOAD_FORM_FLAGS = [
  'ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED',
  'ROLEPLAY_DIRECT_UPLOAD_VERIFICATION_API_ENABLED',
  'ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_ENABLED',
  'ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_PILOT_API_ENABLED',
  'ROLEPLAY_DIRECT_UPLOAD_INCREMENTAL_API_ENABLED',
  'ROLEPLAY_DIRECT_UPLOAD_FORM_ENABLED',
] as const;

export function openingAssignmentConfigured(env: Environment): boolean {
  return OPENING_ASSIGNMENT_FLAGS.every(flag => env[flag] === 'true');
}

/** Configuration inventory only. Never return URLs, keys, or other env values.
 * Public browser variables may have been inlined at build time; presence in
 * this environment is not proof of the deployed browser bundle's configuration. */
export function readDirectUploadPilotConfig(env: Environment) {
  const flags = [...OPENING_ASSIGNMENT_FLAGS, ...DIRECT_UPLOAD_FORM_FLAGS].map(name => ({
    name, configured: env[name] === 'true',
  }));
  const present = (value: string | undefined) => Boolean(value?.trim());
  const requirements = [
    { label: 'NEXT_PUBLIC_SUPABASE_URL', present: present(env.NEXT_PUBLIC_SUPABASE_URL) },
    { label: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', present: present(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) },
    { label: 'URL de Storage del servidor (NEXT_PUBLIC_SUPABASE_URL o SUPABASE_URL)', present: present(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL) },
    { label: 'SUPABASE_SERVICE_ROLE_KEY', present: present(env.SUPABASE_SERVICE_ROLE_KEY) },
    { label: 'FRONTEND_ORIGIN', present: present(env.FRONTEND_ORIGIN) },
  ];
  const directStagesConfigured = DIRECT_UPLOAD_FORM_FLAGS.every(flag => env[flag] === 'true');
  return {
    flags,
    requirements,
    directStagesConfigured,
    formConfigured: openingAssignmentConfigured(env) && directStagesConfigured,
    reservationLookupConfigured: env.ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED === 'true',
    environmentValuesPresent: requirements.every(item => item.present),
    activationAuthorized: false as const,
  };
}
