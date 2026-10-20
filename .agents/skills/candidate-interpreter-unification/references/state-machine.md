# State Machine (candidate → interpreter)

`Candidato` → onboarding (legal/banking/tutorial) → roleplay (invite/start/submit) → review/evaluated → ready → hired (`Activo`)

Access:
- Before onboarding complete: onboarding only.
- Onboarding complete, not hired: roleplay/docs allowed; no production/payroll.
- Hired/active: full interpreter portal.

Roleplay lifecycle remains `DRAFT/INVITED/STARTED/IN_PROGRESS/SUBMITTED/UNDER_REVIEW/EVALUATED/PASSED/FAILED/EXPIRED/CANCELLED`.
Invitation lifecycle: validate → start → consume (consume only on final submit).
Submission: idempotent replay returns stable result; no duplicate responses/evaluations.
