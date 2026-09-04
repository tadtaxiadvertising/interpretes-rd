#Interpreters RD

> Internal CRM platform for managing interpreters, production tracking, QA audits, payroll, and recruitment.

## Architecture

This platform uses a **decoupled two-service architecture**:

| Service | Description | Tech |
| :------ | :---------- | :--- |
| `interpreters-os` | Main application: UI, Auth, Direct Data Access | Next.js 16, Prisma 7, Tailwind v4 |
| `interpreters-api` | REST Service: Webhooks, External integrations | Next.js 16 API Routes, Prisma 7 |

### Dual-Service Synchronization in Easypanel

In this environment:

1. **Direct Data Layer**: Server-side logic (Server Components & Server Actions) communicates directly with the database via a Prisma singleton. This prevents DNS-related latency and errors (`EAI_AGAIN`) during internal service calls.
2. **Decoupled REST API**: Legacy and external-facing endpoints reside in `src/app/api/` and are served via `Dockerfile.api`.

**Key Variables**:

- `DATABASE_URL`: Transaction Pooler (Port 6543) for high-frequency runtime queries.
- `DIRECT_URL`: Session Connection (Port 5432) for schema migrations.
- `NEXT_PUBLIC_SUPABASE_URL` / `KEY`: Client-side Auth and RLS.

> [!IMPORTANT]
> Use **Server Actions** for all internal UI interactivity to ensure maximum stability and type safety. REST endpoints should be reserved for third-party webhooks and cross-service integrations.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for full architecture diagrams.

## Repository Structure (Co-located Mono-Repo)

While built as two separate services, the code currently resides in this single repository for development velocity. Deployment targets specific Dockerfiles.

```text
free-interpreters-os/          
├── src/app/                   # Frontend pages & Layouts
├── src/app/api/               # Backend REST endpoints (interpreters-api)
├── src/app/actions/           # Shared Server Actions
├── src/components/            # React UI components (shared)
├── src/lib/                   # Shared logic (Prisma, Supabase, Utils)
├── docs/                      # Architecture & API specs
├── documentation/             # Corporate SOPs & templates
├── prisma/                    # Master Schema & Migrations
├── Dockerfile                 # Frontend production build (Port 3000)
├── Dockerfile.api             # Backend production build (Port 4000)
└── easypanel/                 # Deployment documentation
```

## Getting Started

### Frontend (this repo)

```bash
cp .env.example .env          # Fill in values
npm install
npm run dev                    # http://localhost:3001
```

### Backend (interpreters-api repo)

```bash
cp .env.example .env          # Fill in values
npm install
npx prisma generate
npm run dev                    # http://localhost:4000
```

## Deployment

Both services deploy to **Easypanel** via GitHub webhook on push to `main`.  
See [easypanel/README.md](./easypanel/README.md) for configuration details.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — System design & dual-auth strategy
- [Development Guide](./docs/DEVELOPMENT_GUIDE.md) — Coding standards & workflows
- [API Specification](./docs/API_SPEC.md) — REST endpoints (Backend)
- [Data Model](./docs/DATA_MODEL.md) — Database schema reference
- [Business Logic](./docs/BUSINESS_LOGIC.md) — Payroll, QA, recruitment rules
- [Corporate Docs](./documentation/README.md) — SOPs, templates, strategic docs
