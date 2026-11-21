/**
 * Cached readiness probe for the small shared PostgreSQL pool.
 *
 * External monitoring and diagnostic requests to /ready must not create
 * an unbounded stream of DB queries. The container's /health liveness probe
 * remains DB-independent; coalesce readiness requests and retry briefly
 * after failure so a recovered database can become ready again.
 */
export function createCachedReadinessProbe(
  check: () => Promise<unknown>,
  now: () => number = Date.now,
): () => Promise<boolean> {
  const successTtlMs = 10_000;
  const failureTtlMs = 2_000;
  let lastCheckedAt = Number.NEGATIVE_INFINITY;
  let lastResult: boolean | undefined;
  let inFlight: Promise<boolean> | undefined;

  return function isReady(): Promise<boolean> {
    if (inFlight) return inFlight;

    const age = now() - lastCheckedAt;
    const ttl = lastResult ? successTtlMs : failureTtlMs;
    if (lastResult !== undefined && age >= 0 && age < ttl) {
      return Promise.resolve(lastResult);
    }

    const attempt = Promise.resolve()
      .then(() => check())
      .then(
        () => true,
        () => false,
      )
      .then((ok) => {
        lastResult = ok;
        lastCheckedAt = now();
        return ok;
      });
    inFlight = attempt;
    void attempt.finally(() => {
      if (inFlight === attempt) inFlight = undefined;
    });
    return attempt;
  };
}
