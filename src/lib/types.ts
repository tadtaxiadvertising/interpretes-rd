// ============================================================
// Shared TypeScript types — Single Source of Truth
// Derived from the Supabase schema (migration_v2)
// ============================================================

export type UserRole = 'admin' | 'candidate' | 'interpreter';
export type RealtimeStatus = 'Online' | 'Offline' | 'Busy';

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  interpreter_id: number | null;
  display_name: string;
  terms_accepted_at: string | null;
  signature_date: string | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_account_type: string | null;
  bank_cedula: string | null;
  onboarding_complete: boolean;
  created_at: string;
}

export interface CallSession {
  id: number;
  interpreter_id: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tariff_snapshot: number;
  call_cost: number | null;
  notes: string | null;
  created_at: string;
}

export interface PayrateAuditEntry {
  id: number;
  interpreter_id: number;
  old_rate: number | null;
  new_rate: number;
  changed_by: string;
  changed_at: string;
}

export interface InterpreterWithStatus {
  id: number;
  externalId: string;
  name: string;
  status: string;
  realtime_status: RealtimeStatus;
  campaign: string | null;
  languageA: string;
  languageB: string;
  tariffPerMinute: number;
  emailCorporativo: string | null;
  pais: string | null;
}

// Generic action result wrapper
export interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  code?: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'SERVICE_UNAVAILABLE' | 'CONFLICT' | 'INTERNAL_ERROR' | 'BAD_REQUEST';
}

// Timer state stored in localStorage
export interface TimerLocalState {
  sessionId: number;
  startedAt: string; // ISO 8601
  interpreterId: number;
}

export interface ComplianceDay {
  date: string;
  isWeekend: boolean;
  minutes: number;
  logsMinutes: number;
  sessionsMinutes: number;
  status: string;
  dailyGoalMinutes: number;
}

export interface ComplianceBoardRow {
  interpreter: {
    id: number;
    name: string;
    shiftStart?: string | null;
    shiftEnd?: string | null;
  };
  monthlyGoal: number;
  mtdMinutes: number;
  fulfillmentPercent: number;
  days: ComplianceDay[];
}
