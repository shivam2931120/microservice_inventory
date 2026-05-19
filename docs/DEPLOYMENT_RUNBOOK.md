# Microservices Inventory Management System Deployment Runbook

This runbook covers the deployed Vercel demo and the remaining inputs needed to run the full Docker/Kubernetes-ready microservices stack in production.

## Current Deployment Status

The project is deployed publicly on Vercel and remains runnable locally with Docker Compose:

- Production Vercel URL: `https://microservice-inventory.vercel.app`
- GitHub repository: `https://github.com/shivam2931120/microservice_inventory`
- Frontend: `http://localhost:5173`
- API Gateway: `http://localhost:3000`
- Health: `http://localhost:3000/health`

The Vercel deployment serves the React frontend and a serverless API adapter backed by the Supabase PostgreSQL schemas. The Docker Compose and Kubernetes assets remain the path for running the complete service topology.

Local verification already passed:

- Full build and tests: `npm run verify`
- Lint: `npm run lint`
- Compose validation: `docker compose config --quiet`
- End-to-end smoke test: product creation, order creation, payment simulation, stock reservation saga, order confirmation
- Live Vercel smoke test: login, product creation, stock adjustment, order creation, reporting, and cleanup against `https://microservice-inventory.vercel.app/api`
- Load test: 1000 requests with 0 failures and more than 1000 requests/minute

## Recommended Full Microservices Deployment Path

Use Kubernetes, because `project.pdf` explicitly calls for Kubernetes deployments, ingress, HPA, CI/CD, and production operations.

Recommended target options:

- DigitalOcean Kubernetes: simplest managed Kubernetes option for a capstone demo.
- AWS EKS or GCP GKE: stronger enterprise signal, but more setup.
- Render/Railway/Fly.io: easier platform deployment, but less aligned with the Kubernetes requirement unless using their container primitives only for demo hosting.

## Inputs Needed From You

Provide these values to finish a public deployment:

| Input                      | Required? | Example                                                           |
| -------------------------- | --------- | ----------------------------------------------------------------- |
| Deployment target          | Yes       | DigitalOcean Kubernetes, EKS, GKE, Render, Railway, Fly.io        |
| Container registry         | Yes       | `ghcr.io/<github-user>` or Docker Hub namespace                   |
| Public domain              | Yes       | `inventory.yourdomain.com`                                        |
| DNS access                 | Yes       | Ability to create `A` or `CNAME` records                          |
| TLS strategy               | Yes       | Platform-managed TLS, NGINX ingress + cert-manager, or Cloudflare |
| Production PostgreSQL URLs | Yes       | Runtime and migration URLs per service                            |
| Production Redis URL       | Yes       | `redis://...`                                                     |
| `JWT_SECRET`               | Yes       | 32+ random characters                                             |
| `INTERNAL_EVENT_TOKEN`     | Yes       | 32+ random characters                                             |
| Kafka broker URL           | Optional  | Required only if `EVENT_TRANSPORT=kafka`                          |
| OpenSearch URL             | Optional  | Required only if `SEARCH_BACKEND=opensearch`                      |
| Grafana admin password     | Optional  | Required if enabling bundled Grafana                              |

## Required Secrets

Generate or provide these:

```bash
JWT_SECRET=<random-32+-character-secret>
INTERNAL_EVENT_TOKEN=<random-32+-character-token>
AUTH_DATABASE_URL=<runtime-postgres-url>
AUTH_DIRECT_URL=<direct-postgres-url-for-migrations>
INVENTORY_DATABASE_URL=<runtime-postgres-url>
INVENTORY_DIRECT_URL=<direct-postgres-url-for-migrations>
ORDER_DATABASE_URL=<runtime-postgres-url>
ORDER_DIRECT_URL=<direct-postgres-url-for-migrations>
REPORTING_DATABASE_URL=<runtime-postgres-url>
REPORTING_DIRECT_URL=<direct-postgres-url-for-migrations>
EVENT_STORE_DATABASE_URL=<event-bus-postgres-url>
REDIS_URL=<production-redis-url>
```

Use direct database URLs for Prisma migrations. If your database provider gives pooled URLs, use those for runtime `*_DATABASE_URL` and direct URLs for `*_DIRECT_URL`.

## Optional Production Features

Enable these when the matching managed services are ready:

```bash
SEARCH_BACKEND=opensearch
OPENSEARCH_URL=<managed-opensearch-or-elasticsearch-url>
PRODUCT_SEARCH_INDEX=inventory-products

EVENT_TRANSPORT=kafka
KAFKA_BROKERS=<broker-host:9092>
KAFKA_EVENTS_TOPIC=inventory.domain-events
```

The app still works without those optional services because it has PostgreSQL search/facets and a durable HTTP event bus fallback.

## Kubernetes Deployment Steps

1. Build and tag images for each workspace:

```bash
docker build -f Dockerfile.service --build-arg WORKSPACE=api-gateway -t <registry>/microservices-inventory-api-gateway:<tag> .
docker build -f Dockerfile.service --build-arg WORKSPACE=auth-service -t <registry>/microservices-inventory-auth-service:<tag> .
docker build -f Dockerfile.service --build-arg WORKSPACE=inventory-service -t <registry>/microservices-inventory-inventory-service:<tag> .
docker build -f Dockerfile.service --build-arg WORKSPACE=order-service -t <registry>/microservices-inventory-order-service:<tag> .
docker build -f Dockerfile.service --build-arg WORKSPACE=reporting-service -t <registry>/microservices-inventory-reporting-service:<tag> .
docker build -f Dockerfile.service --build-arg WORKSPACE=event-bus-service -t <registry>/microservices-inventory-event-bus-service:<tag> .
docker build -f Dockerfile.service --build-arg WORKSPACE=frontend -t <registry>/microservices-inventory-frontend:<tag> .
```

2. Push images:

```bash
docker push <registry>/microservices-inventory-api-gateway:<tag>
docker push <registry>/microservices-inventory-auth-service:<tag>
docker push <registry>/microservices-inventory-inventory-service:<tag>
docker push <registry>/microservices-inventory-order-service:<tag>
docker push <registry>/microservices-inventory-reporting-service:<tag>
docker push <registry>/microservices-inventory-event-bus-service:<tag>
docker push <registry>/microservices-inventory-frontend:<tag>
```

3. Update `k8s/inventory-platform.yaml` image references and ingress host.

4. Create Kubernetes secrets from the production values.

5. Apply the manifest:

```bash
kubectl apply -f k8s/inventory-platform.yaml
```

6. Verify:

```bash
kubectl get pods -n inventory-platform
kubectl get ingress -n inventory-platform
curl -fsS https://<your-domain>/api/health
BASE_URL=https://<your-domain>/api ./scripts/smoke-test.sh
```

## Final Submission Checklist

- Public HTTPS frontend URL works without VPN.
- Public product catalog opens without login.
- Demo credentials are documented for protected admin flows.
- Gateway health returns `ok`.
- Smoke test passes against the public URL.
- GitHub repository is pushed and does not include `.env`, `node_modules`, `dist`, generated Prisma clients, or local test artifacts.
- Report PDF uses the title `Microservices Inventory Management System`.
- Demo video is 3-7 minutes and shows product CRUD, stock update, order confirmation saga, reports, health/metrics, and deployment URL.
