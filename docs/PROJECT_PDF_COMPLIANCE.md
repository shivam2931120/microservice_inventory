# Project PDF Compliance Checklist

This checklist maps the current repository to `project.pdf` for the project titled **Microservices Inventory Management System**.

## Complete In The Application

- Custom API gateway routing with JWT validation.
- Authentication service with register/login/verify and `ADMIN` / `STAFF` role management.
- Inventory service with product CRUD, stock levels, low-stock alerts, optimistic locking, and atomic stock updates.
- Orders service with order creation, status tracking, payment simulation, and saga-based stock confirmation.
- Durable event bus with event storage, delivery retries, audit log, idempotent consumers, and optional Kafka event mirroring.
- Reporting service with sales, inventory, stock-alert, and event-audit projections.
- Product search with OpenSearch support and PostgreSQL fallback category facets.
- Gateway resilience: rate limiting, timeouts, safe-method retries, circuit breakers, and bulkheads.
- Observability: structured JSON logs, propagated correlation IDs, metrics endpoints, Prometheus output, Grafana provisioning, and Jaeger container profile.
- Docker Compose local deployment and Kubernetes manifests with services, probes, resources, ingress, secrets/config, migrations, Redis, and HPAs.
- GitHub Actions CI workflow for install, database setup, lint, tests, and build.
- React admin UI and public demo catalog.
- GitHub repository: `https://github.com/shivam2931120/microservice_inventory`
- Production Vercel URL: `https://microservice-inventory.vercel.app`
- Demo video release: publish from the current repository if required.

## Verification Commands

```bash
npm run verify
npm run lint
docker compose config --quiet
./scripts/docker-local-up.sh
BASE_URL=http://localhost:3000 ./scripts/smoke-test.sh
LOAD_TEST_URL=http://localhost:3000/health LOAD_TEST_REQUESTS=1000 npm run load:test
```

## External Inputs Still Needed For Full Kubernetes Hosting

The Vercel deployment is live. Running the complete Kubernetes topology still needs account-owned infrastructure and secrets:

1. Container registry namespace and image tags.
2. Production deployment target, for example DigitalOcean Kubernetes, EKS, GKE, Render, Railway, or Fly.io.
3. Public domain and DNS access.
4. HTTPS/TLS strategy.
5. Production PostgreSQL connection strings for Auth, Inventory, Order, Reporting, and Event Bus.
6. Production Redis URL.
7. Kafka broker URL if enabling Kafka mode.
8. OpenSearch/Elasticsearch URL if enabling production search mode.
9. Production `JWT_SECRET` and `INTERNAL_EVENT_TOKEN`.
