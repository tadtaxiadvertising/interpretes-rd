/**
 * Vitest-only resolver for Next.js's server-only side-effect marker.
 * Never alias this in Next's production bundler: it must keep rejecting
 * server code imported by Client Components.
 */
export {};
