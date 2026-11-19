/**
 * Read-only, aggregate-only call production reconciliation SQL.
 * Keep it importable without connecting to any database so the exact query
 * used by the operator CLI can be executed in disposable PostgreSQL CI.
 *
 * Values are bound through $1 and $2 (Santo Domingo calendar dates).
 */
export const callProductionReconciliationQuery = `
  WITH session_daily AS (
    SELECT
      cs.interpreter_id,
      (cs.started_at AT TIME ZONE 'America/Santo_Domingo')::date AS production_date,
      COUNT(*)::int AS session_count,
      COUNT(*) FILTER (WHERE cs.ended_at IS NOT NULL)::int AS ended_session_count,
      COUNT(*) FILTER (
        WHERE cs.ended_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.call_production_entries cpe
            WHERE cpe.call_session_id = cs.id
          )
      )::int AS ended_without_ledger_count,
      -- These are lower-bound source buckets, based ONLY on stable app notes
      -- assigned by the two Quick Log flows and default admin manual flow.
      -- Custom admin notes and historical variants remain unclassified.
      COUNT(*) FILTER (
        WHERE cs.ended_at IS NOT NULL
          AND cs.notes IN ('Quick log by interpreter', 'Manual entry via Quick Log')
          AND NOT EXISTS (
            SELECT 1 FROM public.call_production_entries cpe
            WHERE cpe.call_session_id = cs.id
          )
      )::int AS known_quicklog_missing_ledger_count,
      COUNT(*) FILTER (
        WHERE cs.ended_at IS NOT NULL
          AND cs.notes = 'Manual entry by Administrator'
          AND NOT EXISTS (
            SELECT 1 FROM public.call_production_entries cpe
            WHERE cpe.call_session_id = cs.id
          )
      )::int AS known_admin_manual_missing_ledger_count,
      -- Flags only: a legacy/manual session may have legitimate reasons for
      -- differences. Do not infer missing payable minutes from timestamps.
      COUNT(*) FILTER (
        WHERE cs.ended_at IS NOT NULL AND cs.duration_seconds IS NULL
      )::int AS ended_missing_duration_count,
      COUNT(*) FILTER (
        WHERE cs.ended_at >= cs.started_at + INTERVAL '60 seconds'
          AND cs.duration_seconds = 0
      )::int AS ended_zero_duration_with_elapsed_count,
      COUNT(*) FILTER (
        WHERE cs.ended_at IS NOT NULL AND cs.call_cost IS NULL
      )::int AS ended_missing_cost_count,
      COALESCE(SUM(
        CASE
          WHEN cs.ended_at IS NOT NULL
          THEN FLOOR(GREATEST(COALESCE(cs.duration_seconds, 0), 0)::numeric / 60)
          ELSE 0
        END
      ), 0)::int AS ended_session_minutes
    FROM public.call_sessions cs
    WHERE cs.interpreter_id IS NOT NULL
      AND cs.started_at IS NOT NULL
      AND (cs.started_at AT TIME ZONE 'America/Santo_Domingo')::date
          BETWEEN $1::date AND $2::date
    GROUP BY cs.interpreter_id, (cs.started_at AT TIME ZONE 'America/Santo_Domingo')::date
  ),
  ledger_daily AS (
    SELECT
      cpe.interpreter_id,
      cpe.production_date,
      COUNT(*)::int AS ledger_entry_count,
      -- A ledger row may exist with no matching source session, or it may
      -- disagree with the session's owner/operational date. These are
      -- diagnostic flags ONLY; never automatically rewrite payroll.
      COUNT(*) FILTER (WHERE cs.id IS NULL)::int AS ledger_orphan_count,
      COUNT(*) FILTER (
        WHERE cs.id IS NOT NULL
          AND cs.interpreter_id IS DISTINCT FROM cpe.interpreter_id
      )::int AS ledger_owner_mismatch_count,
      COUNT(*) FILTER (
        WHERE cs.id IS NOT NULL
          AND (cs.started_at AT TIME ZONE 'America/Santo_Domingo')::date
              IS DISTINCT FROM cpe.production_date
      )::int AS ledger_day_mismatch_count,
      COALESCE(SUM(cpe.interpreted_minutes), 0)::int AS ledger_minutes,
      COALESCE(SUM(cpe.calls_attended), 0)::int AS ledger_calls
    FROM public.call_production_entries cpe
    LEFT JOIN public.call_sessions cs ON cs.id = cpe.call_session_id
    WHERE cpe.production_date BETWEEN $1::date AND $2::date
    GROUP BY cpe.interpreter_id, cpe.production_date
  ),
  production_daily AS (
    SELECT
      pl.interpreter_id,
      pl.date AS production_date,
      COUNT(*)::int AS production_log_count,
      COALESCE(SUM(COALESCE(pl.verified_minutes, pl.interpreted_minutes, 0)), 0)::int
        AS production_log_effective_minutes,
      COALESCE(SUM(COALESCE(pl.calls_attended, 0)), 0)::int AS production_log_calls
    FROM public.production_logs pl
    WHERE pl.interpreter_id IS NOT NULL
      AND pl.date BETWEEN $1::date AND $2::date
    GROUP BY pl.interpreter_id, pl.date
  ),
  -- Candidate duplicates only. An interpreter may legitimately record two
  -- calls of equal duration close together, so never auto-delete/adjust pay.
  -- Restrict the signal to app-owned Quick Log markers, not arbitrary notes.
  quick_log_sequence AS (
    SELECT
      cs.interpreter_id,
      cs.created_at,
      LAG(cs.created_at) OVER (
        PARTITION BY cs.interpreter_id, cs.duration_seconds, cs.notes
        ORDER BY cs.created_at, cs.id
      ) AS previous_created_at
    FROM public.call_sessions cs
    WHERE cs.interpreter_id IS NOT NULL
      AND cs.started_at IS NOT NULL
      AND cs.ended_at IS NOT NULL
      AND cs.created_at IS NOT NULL
      AND cs.duration_seconds IS NOT NULL
      AND cs.notes IN ('Quick log by interpreter', 'Manual entry via Quick Log')
      AND (cs.started_at AT TIME ZONE 'America/Santo_Domingo')::date
          BETWEEN $1::date AND $2::date
  ),
  quick_log_candidate_duplicates AS (
    SELECT COUNT(*) FILTER (
      WHERE previous_created_at IS NOT NULL
        AND created_at >= previous_created_at
        AND created_at <= previous_created_at + INTERVAL '30 seconds'
    )::bigint AS possible_duplicate_quicklog_sessions
    FROM quick_log_sequence
  ),
  keys AS (
    SELECT interpreter_id, production_date FROM session_daily
    UNION
    SELECT interpreter_id, production_date FROM ledger_daily
    UNION
    SELECT interpreter_id, production_date FROM production_daily
  ),
  interpreter_day AS (
  SELECT
    keys.interpreter_id,
    keys.production_date,
    COALESCE(s.session_count, 0)::int AS session_count,
    COALESCE(s.ended_session_count, 0)::int AS ended_session_count,
    COALESCE(s.ended_without_ledger_count, 0)::int AS ended_without_ledger_count,
    COALESCE(s.known_quicklog_missing_ledger_count, 0)::int AS known_quicklog_missing_ledger_count,
    COALESCE(s.known_admin_manual_missing_ledger_count, 0)::int AS known_admin_manual_missing_ledger_count,
    COALESCE(s.ended_missing_duration_count, 0)::int AS ended_missing_duration_count,
    COALESCE(s.ended_zero_duration_with_elapsed_count, 0)::int AS ended_zero_duration_with_elapsed_count,
    COALESCE(s.ended_missing_cost_count, 0)::int AS ended_missing_cost_count,
    COALESCE(s.ended_session_minutes, 0)::int AS ended_session_minutes,
    COALESCE(l.ledger_entry_count, 0)::int AS ledger_entry_count,
    COALESCE(l.ledger_orphan_count, 0)::int AS ledger_orphan_count,
    COALESCE(l.ledger_owner_mismatch_count, 0)::int AS ledger_owner_mismatch_count,
    COALESCE(l.ledger_day_mismatch_count, 0)::int AS ledger_day_mismatch_count,
    COALESCE(l.ledger_minutes, 0)::int AS ledger_minutes,
    COALESCE(l.ledger_calls, 0)::int AS ledger_calls,
    COALESCE(p.production_log_count, 0)::int AS production_log_count,
    COALESCE(p.production_log_effective_minutes, 0)::int AS production_log_effective_minutes,
    COALESCE(p.production_log_calls, 0)::int AS production_log_calls,
    (COALESCE(s.ended_session_minutes, 0) - COALESCE(l.ledger_minutes, 0))::int
      AS session_minus_ledger_minutes,
    (COALESCE(p.production_log_effective_minutes, 0) - COALESCE(l.ledger_minutes, 0))::int
      AS production_log_minus_ledger_minutes
  FROM keys
  LEFT JOIN session_daily s
    ON s.interpreter_id = keys.interpreter_id
   AND s.production_date = keys.production_date
  LEFT JOIN ledger_daily l
    ON l.interpreter_id = keys.interpreter_id
   AND l.production_date = keys.production_date
  LEFT JOIN production_daily p
    ON p.interpreter_id = keys.interpreter_id
   AND p.production_date = keys.production_date
  )
  -- Aggregate inside PostgreSQL so identifiers and daily rows never
  -- leave the database for an operator-facing report.
  SELECT
    COUNT(*)::bigint AS interpreter_day_groups,
    COALESCE(SUM(session_count), 0)::bigint AS total_sessions,
    COALESCE(SUM(ended_session_count), 0)::bigint AS ended_sessions,
    COALESCE(SUM(ended_without_ledger_count), 0)::bigint AS ended_without_ledger_sessions,
    COALESCE(SUM(known_quicklog_missing_ledger_count), 0)::bigint AS known_quicklog_without_ledger_sessions,
    COALESCE(SUM(known_admin_manual_missing_ledger_count), 0)::bigint AS known_admin_manual_without_ledger_sessions,
    COALESCE(SUM(ended_missing_duration_count), 0)::bigint AS ended_missing_duration_sessions,
    COALESCE(SUM(ended_zero_duration_with_elapsed_count), 0)::bigint AS ended_zero_duration_with_elapsed_sessions,
    COALESCE(SUM(ended_missing_cost_count), 0)::bigint AS ended_missing_cost_sessions,
    (SELECT possible_duplicate_quicklog_sessions FROM quick_log_candidate_duplicates)
      AS possible_duplicate_quicklog_sessions,
    COALESCE(SUM(ended_session_minutes), 0)::bigint AS ended_session_minutes,
    COALESCE(SUM(ledger_entry_count), 0)::bigint AS ledger_entries,
    COALESCE(SUM(ledger_orphan_count), 0)::bigint AS ledger_orphan_entries,
    COALESCE(SUM(ledger_owner_mismatch_count), 0)::bigint AS ledger_owner_mismatch_entries,
    COALESCE(SUM(ledger_day_mismatch_count), 0)::bigint AS ledger_day_mismatch_entries,
    COALESCE(SUM(ledger_minutes), 0)::bigint AS ledger_minutes,
    COALESCE(SUM(production_log_count), 0)::bigint AS production_logs,
    COALESCE(SUM(production_log_effective_minutes), 0)::bigint AS production_effective_minutes,
    COALESCE(SUM(session_minus_ledger_minutes), 0)::bigint AS session_minus_ledger_minutes,
    COALESCE(SUM(production_log_minus_ledger_minutes), 0)::bigint AS production_minus_ledger_minutes,
    COUNT(*) FILTER (WHERE session_minus_ledger_minutes <> 0)::bigint AS groups_with_session_ledger_difference,
    COUNT(*) FILTER (WHERE production_log_minus_ledger_minutes <> 0)::bigint AS groups_with_production_ledger_difference,
    COUNT(*) FILTER (WHERE ended_without_ledger_count > 0)::bigint AS groups_with_ended_calls_without_ledger
  FROM interpreter_day
`;
