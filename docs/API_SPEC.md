# API Specification & Webhooks

> **Service**: `interpreters-api` (Backend — co-located with Frontend)
> **Base URL**: `https://api.example.com` (production) / `http://localhost:3001` (local)
> **Auth**: All endpoints require a valid Supabase `Authorization: Bearer <token>` header unless marked as public.
> **Runtime**: Next.js 15.2.6 — All dynamic route params are `Promise<{ id: string }>`.

All endpoints reside and execute **exclusively** within the Next.js application. The Frontend
communicates with these endpoints via `NEXT_PUBLIC_API_URL` or directly via Server Actions.
Endpoints are designed for fast `< 10s` execution within Supabase free-tier limits.

## Dynamic Routes in Next.js 15.2.6

> **Critical**: All dynamic API routes must handle parameters asynchronously.

```typescript
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const id = resolvedParams.id;
  // ...
}
```

---

## 1. Interpreters Roster

### 1.1 List Interpreters

**Endpoint:** `GET /api/interpreters`
**Purpose:** Fetch the list of all interpreters for the roster.
**Query Params:**

- `status` (optional): Filter by status (e.g., `Activo`, `Inactivo`).
- `search` (optional): Search by name, externalId, or campaign.

**Response (200 OK):**

```json
[
  {
    "id": 1,
    "name": "Jane Doe",
    "externalId": "INT-001",
    "status": "Activo",
    "campaign": "HealthCare",
    "tariffPerMinute": 0.15,
    "monthlyGoal": 2000
  }
]
```

### 1.2 Create Interpreter

**Endpoint:** `POST /api/interpreters`
**Purpose:** Create a new interpreter record + optional Supabase Auth user.
**Request Body:** (Validated by `InterpreterSchema`)

```json
{
  "name": "John Smith",
  "externalId": "INT-002",
  "emailCorporativo": "john@example.com",
  "tariffPerMinute": 0.12,
  "status": "Activo",
  "password": "securepass123",
  "monthlyGoal": 2000,
  "banco": "Popular",
  "tipoCuenta": "Ahorro",
  "cedulaRnc": "001-1234567-8",
  "paymentFrequency": "Monthly",
  "paymentDay": "1"
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "interpreter": { "id": 2, "name": "John Smith" }
}
```

### 1.3 Update Interpreter

**Endpoint:** `PUT /api/interpreters/[id]`
**Purpose:** Update an existing interpreter's profile.
**Request Body:** Partial `InterpreterSchema` fields.

**Response (200 OK):**

```json
{
  "success": true,
  "interpreter": { "id": 2, "name": "John Smith Updated" }
}
```

### 1.4 Delete Interpreter

**Endpoint:** `DELETE /api/interpreters/[id]`
**Purpose:** Soft-delete or permanently remove an interpreter and linked Auth user.

**Response (200 OK):**

```json
{ "success": true }
```

---

## 2. Monthly Goals (MTD)

### 2.1 Get Interpreter MTD Progress

**Implementation:** Server Component (`src/app/dashboard/page.tsx`)
**Purpose:** Calculate Month-To-Date production minutes against the interpreter's
individual `monthlyGoal`.

**Calculation Logic:**

```typescript
// Combined minutes from CSV imports + live timer sessions
const logMinutes = productionLogs.reduce((sum, log) => sum + log.interpretedMinutes, 0);
const sessionMinutes = Math.round(
  callSessions.reduce((sum, c) => sum + (c.durationSeconds || 0), 0) / 60
);
const mtdMinutes = logMinutes + sessionMinutes;

// Dynamic goal from interpreter.monthlyGoal (default: 2000)
const monthlyGoal = interpreter.monthlyGoal ?? 2000;
const mtdProgress = Math.min((mtdMinutes / monthlyGoal) * 100, 100);
```

**Data Sources:**

| Source | Table | Filter |
| --- | --- | --- |
| CSV Production | `production_logs` | `date >= startOfMonth AND date <= endOfMonth` |
| Live Timer | `call_sessions` | `startedAt >= startOfMonth AND endedAt IS NOT NULL` |

### 2.2 Update Monthly Goal (Admin)

**Endpoint:** `PUT /api/interpreters/[id]`
**Field:** `monthlyGoal` (integer, minutes)
**Default:** `2000`

---

## 3. Ranking System

### 3.1 Get Full Ranking

**Implementation:** Server Component (`src/app/dashboard/ranking/page.tsx`)
**Purpose:** Display a leaderboard of all active interpreters sorted by total monthly
minutes (descending).

**Query Strategy (Optimized):**

```typescript
const allInterpreters = await prisma.interpreter.findMany({
  where: { status: 'Activo' },
  select: {
    id: true,
    name: true,
    campaign: true,
    monthlyGoal: true,
    callSessions: {
      where: {
        startedAt: { gte: startOfMonth, lte: endOfMonth },
        endedAt: { not: null },
      },
      select: { durationSeconds: true },
    },
    productionLogs: {
      where: { date: { gte: startOfMonth, lte: endOfMonth } },
      select: { interpretedMinutes: true },
    },
    qaScores: {
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { totalScore: true },
    },
  },
});
```

**Ranking Criteria:**

1. **Primary:** Total minutes interpreted (session + log combined)
2. **Tiebreaker:** QA Score (highest wins)

**Response Shape (internal):**

```typescript
interface RankingEntry {
  id: number;
  name: string;
  campaign: string | null;
  totalMinutes: number;
  qaScore: number;
  monthlyGoal: number;
  goalProgress: number; // percentage
}
```

### 3.2 Sidebar Mini-Ranking

**Implementation:** Server Component (`src/app/dashboard/layout.tsx`)
**Purpose:** Compute the current interpreter's position and pass to the `Sidebar`.

**Returns:**

```typescript
interface SidebarRanking {
  position: number;       // 1-indexed
  totalInterpreters: number;
  myMinutes: number;
  avgMinutes: number;
}
```

---

## 4. Call Sessions (Timer)

### 4.1 Start Call

**Implementation:** Server Action (`src/app/actions/calls.ts → startCall`)
**Purpose:** Create a new `CallSession` with `startedAt = now()`.

**Returns:**

```json
{
  "success": true,
  "data": {
    "sessionId": 42,
    "startedAt": "2026-05-01T19:00:00.000Z"
  }
}
```

### 4.2 End Call

**Implementation:** Server Action (`src/app/actions/calls.ts → endCall`)
**Purpose:** Set `endedAt`, calculate `durationSeconds` and `callCost`.

**Returns:**

```json
{
  "success": true,
  "data": {
    "durationSeconds": 540,
    "callCost": 1.35
  }
}
```

### 4.3 Manual Call Log

**Endpoint:** `POST /api/calls/manual`
**Purpose:** Register a manually-entered call duration (when timer wasn't used).
**Request Body:**

```json
{
  "durationMinutes": 15
}
```

**Response (201 Created):**

```json
{ "success": true, "sessionId": 43 }
```

---

## 5. Onboarding Actions

### 5.1 Accept Terms

**Implementation:** Server Action (`src/app/actions/onboarding.ts → acceptTerms`)
**Effect:** Sets `terms_accepted_at` and `signature_date` on `user_profiles`.

### 5.2 Save Banking Details

**Implementation:** Server Action (`src/app/actions/onboarding.ts → saveBankingDetails`)
**Request:**

```typescript
{ 
  bankName: string; 
  bankAccount: string; 
  bankCedula: string; 
  bankAccountType: "Ahorros" | "Corriente" 
}
```

**Validation:** All fields required, trimmed.

### 5.3 Complete Onboarding

**Implementation:** Server Action (`src/app/actions/onboarding.ts → completeOnboarding`)
**Effect:** Sets `onboarding_complete = true` on `user_profiles`.

### 5.4 Get Onboarding Status

**Implementation:** Server Action (`src/app/actions/onboarding.ts → getOnboardingStatus`)
**Returns:**

```json
{
  "success": true,
  "data": {
    "termsAccepted": true,
    "bankingComplete": false,
    "onboardingComplete": false
  }
}
```

---

## 6. Production Logs Ingestion

**Endpoint:** `POST /api/import/csv`
**Purpose:** Bulk upsert daily production minutes from the telephony system via CSV.

**Request Body (FormData):**

- `file`: CSV file with columns: `name`, `minutes`, `date`, `externalId`.

**Response (200 OK):**

```json
{
  "success": true,
  "importedCount": 42,
  "errors": []
}
```

---

## 7. Payroll Execution Engine

**Implementation:** Server Action (`src/app/actions/payroll.ts → generatePayrollAction`)
**Purpose:** Calculate payroll for a given period for all active interpreters.

**Signature:**

```typescript
export async function generatePayrollAction(
  periodStart: Date,
  periodEnd: Date
): Promise<{ success: boolean; recordsCreated?: number; error?: string }>
```

**Payroll Calculation Details:**

- **Gross Total**: `totalMinutes * tariffPerMinute`
- **Verification Override**: If `verifiedMinutes` is present, it replaces `totalMinutes` in the calculation.
- **Incentives**: Manually added `incentivesTotal` are summed into the `netTotal`.
- **Quality Bonus**: Calculated based on QA Score averages for the period.

> [!NOTE]
> Automatically protected by Supabase Auth and Admin Role checks.

### 7.2 Mark as PAID

**Endpoint:** `PATCH /api/payroll/pay`
**Purpose:** Mark a payroll record as PAID and record the transaction reference.

**Request Body:**

```json
{
  "payrollRecordId": "cuid-string",
  "transactionReference": "TX-123456"
}
```

**Response (200 OK):**

```json
{ "success": true, "data": { "status": "PAID" } }
```

### 7.3 Verify Minutes

**Endpoint:** `POST /api/payroll/verify`
**Purpose:** Update the `verifiedMinutes` for a payroll record.

**Request Body:**

```json
{
  "payrollRecordId": "cuid-string",
  "verifiedMinutes": 1500
}
```

**Response (200 OK):**

```json
{ "success": true, "data": { "verifiedMinutes": 1500 } }
```

---

## 8. Recruitment Webhook

**Endpoint:** `POST /api/v1/webhooks/recruitment`
**Purpose:** Triggered by Typeform/Google Forms/Make when a new candidate applies.

**Request Body:**

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "telefono": "+123456789",
  "pais": "Colombia",
  "fuente": "LinkedIn"
}
```

**Response (201 Created):**

```json
{ "success": true, "candidateId": 101, "status": "Aplicante" }
```

---

## HTTP Status Codes

| Code | Meaning |
| --- | --- |
| `200 OK` | Request successful |
| `201 Created` | Resource successfully created |
| `400 Bad Request` | Missing fields or validation error (Zod) |
| `401 Unauthorized` | Invalid API Key / Token |
| `404 Not Found` | Referenced entity does not exist |
| `409 Conflict` | Unique constraint violation (duplicate externalId, email) |
| `500 Internal Server Error` | Database crash or execution timeout |

---

## Rate Limiting & Performance

| Constraint | Value | Notes |
| --- | --- | --- |
| Max response time | < 10s | Supabase Edge timeout |
| DB connection pool | 5 connections | PgBouncer transaction mode |
| Max CSV file size | 5MB | Validated in API route |
| Prisma query timeout | 5000ms | Set in Prisma Client config |
