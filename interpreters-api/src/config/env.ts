import 'dotenv/config';
import { parseApiRuntimeEnv } from './runtime-env-policy.js';

const env = parseApiRuntimeEnv(process.env);

if (!env.success) {
  console.error('INVALID_API_RUNTIME_CONFIGURATION: ' + env.fields.join(', '));
  process.exit(1);
}

export const ENV = env.data;
