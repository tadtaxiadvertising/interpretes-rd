type Env = Readonly<Record<string, string | undefined>>;

/** Only a missing/empty setting or an explicit environment setting selects legacy credentials. */
export function providerSource(env: Env): 'environment' | 'vault' | 'invalid' {
  const source = env.EMAIL_PROVIDER_SOURCE;
  return source === 'vault' ? 'vault' : !source || source === 'environment' ? 'environment' : 'invalid';
}
