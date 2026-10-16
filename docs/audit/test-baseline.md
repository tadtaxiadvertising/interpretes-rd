# Test Baseline

Measured at commit `f6f1d00d` plus the roleplay/funnel repair change set.

## Command

```bash
npx vitest run --pool=threads --maxWorkers=2
```

`npm test` uses default worker settings and can flake on worker startup on this Windows host; the explicit `--pool=threads --maxWorkers=2` form is the reliable gate.

## Result

- **Test files:** 17 passed
- **Tests:** 137 passed (0 failed)

## Suites

| File | Tests |
|---|---|
| `src/app/api/roleplay/convert-audio/__tests__/route.test.ts` | 6 |
| `src/app/actions/__tests__/roleplay-start-candidate.test.ts` | 5 (new) |
| `src/app/actions/__tests__/roleplay-candidate-access.test.ts` | 6 (extended) |
| `src/services/metrics/__tests__/metrics-service.test.ts` | 8 |
| `src/lib/ranking/__tests__/calculate.test.ts` | 7 |
| `src/app/actions/__tests__/onboarding.test.ts` | 10 |
| `src/app/actions/__tests__/recruitment.test.ts` | 4 |
| `src/services/roleplay/__tests__/roleplay-service.test.ts` | 13 |
| `src/lib/auth/__tests__/current-actor.test.ts` | 12 |
| `src/services/onboarding/__tests__/onboarding-service.test.ts` | 11 |
| `src/lib/stats/__tests__/landing-stats.test.ts` | 2 |
| `src/lib/identity/__tests__/resolve-user.test.ts` | 16 |
| `src/app/actions/__tests__/profile.test.ts` | 8 |
| `src/app/api/presence/roster/__tests__/route.test.ts` | 2 |
| `src/services/recruitment/__tests__/recruitment-service.test.ts` | 4 |
| `src/lib/identity/__tests__/roleplay-state.test.ts` | 20 |
| `src/lib/auth/__tests__/cron-auth.test.ts` | 3 |

## Coverage added by the repair

- `startCandidateRoleplay`: unauthenticated → `requiresAuth`; normalized-email candidate lookup; fresh create (session + scenario + access + cookie); resume existing session without duplicate; promote `DRAFT` → `STARTED`.
- `confirmRoleplayResponse`: candidate cookie-missing and cookie-mismatch rejection; cookie-match allow; interpreter ownership allow/reject; per-scenario `RoleplayResponse` persistence when `scenarioId` supplied.

## Other gates

- `npm run lint` → clean (3 pre-existing `react-hooks/exhaustive-deps` warnings in `Recorder.tsx`, `RoleplayIntro.tsx`).
- `npm run build` → passes (38 static pages).

## Not covered (BLOCKED / not executed)

- Live Supabase audio upload/conversion (needs credentials).
- End-to-end browser run of `/roleplays/[id]` recording.
- Admin multi-scenario creation (feature is broken; no route to test).
- Deployment status could not be confirmed from CI artifacts in this session.
