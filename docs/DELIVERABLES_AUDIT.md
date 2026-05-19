# Microservices Inventory Management System Deliverables Audit

Source of truth: `project.pdf`.

## Functional Requirements

| PDF ID | Requirement                                                                                             | Status   | Evidence                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01    | Service discovery / API gateway with routing and JWT auth proxy                                         | Complete | `services/api-gateway` routes `/auth`, `/products`, `/inventory`, `/orders`, `/reports`, `/events`; protected paths call `/auth/verify` before proxying.         |
| F02    | Authentication service with JWT issuance, validation, and roles                                         | Complete | `auth-service` supports register, login, `/auth/me`, `/auth/verify`, and `ADMIN` / `STAFF` roles.                                                                |
| F03    | Inventory service with product CRUD, stock levels, low-stock alerts, atomic updates, optimistic locking | Complete | `inventory-service` exposes product CRUD, stock update endpoints, version checks, low-stock event publishing, and tests for stock events.                        |
| F04    | Orders service with order creation, status tracking, payment simulation, saga flow                      | Complete | `order-service` creates orders, records payment/status history, publishes `OrderCreated`, and consumes stock outcomes.                                           |
| F05    | Event bus with async communication, at-least-once delivery, idempotency                                 | Complete | `event-bus-service` stores events, retries delivery, supports optional Kafka mirroring, and consumers store processed event IDs.                                 |
| F06    | Reporting and search with aggregations, faceted search, realtime stock metrics                          | Complete | `reporting-service` projects sales, inventory, alerts, and event audit data; product search supports OpenSearch and PostgreSQL category facets.                  |
| F07    | Resilience patterns: circuit breakers, retries, timeouts, bulkheads                                     | Complete | Gateway has timeout, retry, circuit breaker, rate limiting, and per-upstream bulkhead logic. Event bus retries delivery.                                         |
| F08    | Observability: structured logs, metrics, tracing/correlation                                            | Complete | Shared middleware emits JSON logs, request metrics, Prometheus metrics, and `x-correlation-id` across services; Grafana/Prometheus/Jaeger profiles are included. |

## Project Submission Deliverables

| PDF deliverable                    | Status                | Notes                                                                                                                                                                                                                            |
| ---------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project Documentation / Report PDF | Complete              | `docs/Microservices_Inventory_Management_System_Report.pdf` is generated from the editable HTML source at `docs/Microservices_Inventory_Management_System_Report.html`.                                                          |
| Live Public Demo URL               | Complete              | `https://microservice-inventory.vercel.app` serves the React frontend and Vercel API adapter backed by the Supabase PostgreSQL schemas.                                                                                          |
| GitHub Repository                  | Complete              | `https://github.com/shivam2931120/microservice_inventory`                                                                                                                                                                        |
| README.md per project              | Complete              | Root `README.md` is aligned to the `Microservices Inventory Management System` title and includes run, verify, deployment, credentials, and submission notes.                                                                     |
| Demo Video                         | Pending if required   | Publish a new release from the current repository if a hosted walkthrough video is required.                                                                                                                                      |

## Current Verification

- `npm run verify`: passed.
- `npm run lint`: passed.
- `docker compose config --quiet`: passed.
- `BASE_URL=http://localhost:3000 ./scripts/smoke-test.sh`: passed against Docker Compose.
- Live Vercel smoke test against `https://microservice-inventory.vercel.app/api`: passed for login, product creation, stock adjustment, order creation, reporting, and cleanup.
- `LOAD_TEST_URL=http://localhost:3000/health LOAD_TEST_REQUESTS=1000 npm run load:test`: passed with 1000 completed requests, 0 failures, 8496.18 requests/minute, and 524.06 ms p95 latency.

## Remaining Inputs For Full Kubernetes Production Deployment

- Container registry namespace or account.
- Production hosting target, Kubernetes cluster, or managed container platform.
- Public domain and DNS access for a stable HTTPS URL.
- Production database, Redis, Kafka, and OpenSearch URLs if using managed services.
- Production secrets: `JWT_SECRET`, `INTERNAL_EVENT_TOKEN`, database passwords/URLs, and optional `GRAFANA_ADMIN_PASSWORD`.
