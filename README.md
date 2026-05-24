# Microservices Inventory Management System

Production-grade microservices inventory and order management platform built to match `project.pdf` in this directory.

## Submission Links

- GitHub repository: `https://github.com/shivam2931120/microservice_inventory`
- Production Vercel deployment: `https://microservice-inventory.vercel.app`
- Demo video release: publish from the current repository if required.
- Report PDF: [`docs/Microservices_Inventory_Management_System_Report.pdf`](docs/Microservices_Inventory_Management_System_Report.pdf)

The Vercel deployment serves the React frontend and a serverless API adapter backed by the Supabase PostgreSQL schemas. The Docker Compose and Kubernetes paths remain available for the full multi-service runtime.

## Stack

- Frontend: React, TypeScript, TailwindCSS, React Router, Axios, Redux Toolkit
- Backend: NestJS services only
- Data: PostgreSQL, Prisma ORM, versioned migrations, optional OpenSearch product search
- Messaging/cache: durable event log, optional Kafka event stream mirror, Redis-backed gateway rate limiting
- Auth: JWT with Admin/Staff RBAC
- Runtime: Docker Compose for local execution, Kubernetes manifests for cluster deployment
- Resilience/observability: gateway rate limiting, timeouts, safe-method retries, circuit breakers, bulkheads, correlation IDs, structured JSON request logs, Prometheus metrics, Grafana provisioning, and Jaeger container profile

## Services

- `api-gateway`: ingress routing, rate limiting, JWT validation, health aggregation
- `auth-service`: registration, login, token verification, user roles
- `inventory-service`: product catalog CRUD, stock adjustments, low-stock alerts, order stock reservation consumer
- `order-service`: order placement, order status, saga event consumers and compensation event publishing
- `reporting-service`: sales, inventory, and stock-alert projections from domain events
- `event-bus-service`: HTTP event ingress with PostgreSQL durable event log, retry delivery, audit log, and optional Kafka topic publishing
- `frontend`: internal admin UI and public demo catalog

## Operational Features

The Vercel runtime includes a self-initializing operational layer for the live Supabase-backed deployment:

- Stock movement ledger for opening stock, manual adjustments, order reservations, product imports, and purchase receipts.
- Purchase orders with supplier details, line items, receive/cancel actions, and automatic stock updates.
- Real workspace notifications for low stock, order activity, imports, product deletes, and purchasing events.
- Bulk product CSV import/export from the Operations and Products screens.
- Advanced product search, stock-status filters, and server-side sorting.
- SKU, barcode, and QR-style code generation for product identification.
- Multi-warehouse inventory summaries with a default primary warehouse.
- Admin audit logs for product, stock, order, purchasing, warehouse, import, and user actions.
- Admin user management for creating users, changing roles, and disabling accounts.
- Smart reports for stock valuation, fast movers, reorder suggestions, supplier performance, dead stock, and warehouse utilization.

## Run With Docker

```bash
docker compose up --build
```

If your `.env` contains remote database URLs and you want the bundled local PostgreSQL/Redis stack, use:

```bash
./scripts/docker-local-up.sh
```

Full local infrastructure profiles:

```bash
# Search/facets through OpenSearch
SEARCH_BACKEND=opensearch docker compose --profile search up --build

# Kafka topic publishing for the event stream
EVENT_TRANSPORT=kafka KAFKA_BROKERS=kafka:9092 docker compose --profile broker up --build

# Prometheus, Grafana, and Jaeger
docker compose --profile observability up --build
```

Open:

- Frontend: `http://localhost:5173`
- Gateway: `http://localhost:3000`
- Swagger per service: `http://localhost:3001/docs`, `3002/docs`, `3003/docs`, `3004/docs`, `3005/docs`

Seeded users only:

- Admin: `admin` / `ChangeMe123!`
- Staff: `staff` / `ChangeMe123!`

The seed process creates a small public demo catalog. Orders remain user-created so the saga flow can be demonstrated live.

## Local Development

```bash
cp .env.example .env
npm install
npm run db:generate
npm run dev
```

Run PostgreSQL first, or use the `postgres` service from Docker Compose:

```bash
docker compose up postgres
npm run db:migrate
npm run seed
npm run dev
```

## Verification

```bash
npm run verify
BASE_URL=http://localhost:3000 ./scripts/smoke-test.sh
LOAD_TEST_URL=http://localhost:3000/health LOAD_TEST_REQUESTS=1000 npm run load:test
```

Record a 3-7 minute submission walkthrough:

```bash
DEMO_BASE_URL=http://localhost:8080 npm run record:demo
```

Latest local verification:

- `npm run verify`: passed.
- `npm run lint`: passed.
- `docker compose config --quiet`: passed.
- Docker smoke test: passed, including product creation, order creation, payment simulation, stock-reservation saga, and order confirmation.
- Vercel smoke test: passed against `https://microservice-inventory.vercel.app/api`.
- Clean health load test: 1000 requests, 0 failures, 8496.18 requests/minute, p95 524.06 ms.

Health and metrics endpoints:

- Gateway aggregate health: `http://localhost:3000/health`
- Gateway request metrics: `http://localhost:3000/metrics`
- Gateway Prometheus metrics: `http://localhost:3000/metrics/prometheus`
- Per-service Swagger: `http://localhost:3001/docs` through `http://localhost:3005/docs`
- Grafana with the observability profile: `http://localhost:3006`
- Prometheus with the observability profile: `http://localhost:9090`
- Jaeger with the observability profile: `http://localhost:16686`

## Deployment

```bash
kubectl apply -f k8s/inventory-platform.yaml
```

For production, replace secret values, use managed PostgreSQL or provision databases before migrations, configure TLS ingress, publish service images with the tags referenced in the manifest, and set `SEARCH_BACKEND=opensearch` plus `EVENT_TRANSPORT=kafka` only after those services are reachable.

Database connection string guidance is in [`docs/POSTGRESQL_DEPLOYMENT.md`](docs/POSTGRESQL_DEPLOYMENT.md). In short: use transaction-pooler URLs for `*_DATABASE_URL` in production, and direct URLs for `*_DIRECT_URL` so Prisma migrations do not run through a transaction pooler.

The frontend reads `VITE_API_URL` at container start and writes `runtime-config.js`, so the same image can point at local Docker (`http://localhost:3000`) or Kubernetes ingress (`https://inventory.example.com/api`) without rebuilding. The gateway accepts both direct API paths (`/auth/login`) and ingress-prefixed paths (`/api/auth/login`).

The Kubernetes manifest creates the service databases on first PostgreSQL startup, runs Prisma migrations before each database-backed service starts, uses Kubernetes Secrets for database/JWT/event credentials, and supports both `/api` and `/api/v1` ingress API paths.

Deployment inputs still required for a public HTTPS submission are listed in [`docs/DEPLOYMENT_RUNBOOK.md`](docs/DEPLOYMENT_RUNBOOK.md).
