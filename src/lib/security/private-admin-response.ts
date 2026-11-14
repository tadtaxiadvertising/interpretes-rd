import { NextResponse } from 'next/server';

/**
 * Protect administrative API data from shared/browser intermediary caching.
 * Vary by both supported authentication channels and configured CORS Origin.
 */
export function privateAdminResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  const vary = (response.headers.get('Vary') || '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  for (const required of ['Authorization', 'Cookie', 'Origin']) {
    if (!vary.some((field) => field.toLowerCase() === required.toLowerCase())) {
      vary.push(required);
    }
  }
  response.headers.set('Vary', vary.join(', '));
  return response;
}

export function privateAdminJson(body: unknown, init?: ResponseInit): NextResponse {
  return privateAdminResponse(NextResponse.json(body, init));
}
