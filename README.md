# Intérpretes RD

> Plataforma de gestión de intérpretes en la República Dominicana para postulación, seguimiento profesional, operaciones, control de calidad y nómina.

## Identidad de marca

El nombre oficial y único del producto es **Intérpretes RD**. Utiliza esta denominación en títulos, textos de interfaz, metadatos, documentación y comunicaciones del producto. No utilices «Free Interpreters» como nombre, marca ni variante del producto. El identificador técnico del repositorio y del paquete puede permanecer como `interpretes-rd`.

## Architecture

This platform uses a **decoupled two-service architecture**:

| Service | Description | Tech |
| :------ | :---------- | :--- |
| `interpretes-rd` | Aplicación principal: interfaz, autenticación y acceso directo a datos | Next.js 15.5.28, Prisma 7, Tailwind v4 |
| `interpreters-api` | REST Service: Webhooks, External integrations | Express 4, TypeScript, Prisma 7 |

### Dual-Service Synchronization in Easypanel

In this environment:

1. **Direct Data Layer**: Server-side logic (Server Components & Server Actions) communicates directly with the database via a Prisma singleton. This prevents DNS-related latency and errors (`EAI_AGAIN`) during internal service calls.
2. **Decoupled REST API**: The independent Express API lives in `interpreters-api/src/` and is built from the repository root with `Dockerfile.api`. Next.js route handlers in `src/app/api/` belong to the frontend service (`Dockerfile`), not the Express image.

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
interpretes-rd/          
├── src/app/                   # Frontend pages & Layouts
├── src/app/api/               # Next.js route handlers in the frontend service
├── src/app/actions/           # Shared Server Actions
├── src/components/            # React UI components (shared)
├── src/lib/                   # Shared logic (Prisma, Supabase, Utils)
├── docs/                      # Architecture & API specs
├── documentation/             # Corporate SOPs & templates
├── prisma/                    # Master Schema & Migrations
├── Dockerfile                 # Frontend production build (Port 3000)
├── interpreters-api/          # Independent Express REST API source
├── Dockerfile.api             # Express backend production build (Port 3000)
└── easypanel/                 # Deployment documentation
```

## Getting Started

### Frontend (this repo)

```bash
cp .env.example .env          # Fill in values
npm install
npm run dev                    # http://localhost:3001
```

### Backend (co-located `interpreters-api/` directory)

```bash
cd interpreters-api
# Set the required environment variables without committing secrets.
npm ci
npx prisma generate
npm run dev                    # default: http://localhost:3000
```

## Deployment

The repository has separate production images: `Dockerfile` (Next.js frontend) and `Dockerfile.api` (Express API). **Both build contexts must be the repository root (`.`)**; configuring the API to build with the frontend Dockerfile can exhaust the small Easypanel VPS and deploy the wrong application. The internal default port is `3000` for each container; route by service/domain, not by assuming that the API runs on port `4000`.

The Express image uses `GET /health` for process liveness; `GET /ready` checks PostgreSQL independently and may return 503 during database outages. A healthy liveness response does not prove database connectivity. Before any production change, verify the actual Easypanel build file, health override, available resources and rollback target. CI success or a successful webhook attempt does not by itself prove the deployed image revision.

Deployments are triggered through GitHub Actions/Easypanel webhooks after eligible `main` workflows; the optional audio worker is separately gated. See [easypanel/README.md](./easypanel/README.md) for service-specific configuration and [GitHub Actions](./.github/workflows/) for the current deployment conditions.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — System design & dual-auth strategy
- [Development Guide](./docs/DEVELOPMENT_GUIDE.md) — Coding standards & workflows
- [API Specification](./docs/API_SPEC.md) — REST endpoints (Backend)
- [Data Model](./docs/DATA_MODEL.md) — Database schema reference
- [Business Logic](./docs/BUSINESS_LOGIC.md) — Payroll, QA, recruitment rules
- [Corporate Docs](./documentation/README.md) — SOPs, templates, strategic docs
