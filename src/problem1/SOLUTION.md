# Problem 1 — Building Castle In The Cloud

## Scope (intentionally limited)

Binance-like surface area for this design:

- Login / auth
- Market-data API
- Order submission
- Order processing (async)
- Portfolio / balance
- WebSocket price & order updates

**Constraints:** AWS only, **500 RPS**, **p99 < 100 ms**. First version is multi-AZ and horizontally scalable, but **cost-conscious** — not a matching-engine mega-scale clone.

## Architecture overview

See [architecture.png](./architecture.png).

```
Users
  ↓
Route 53
  ↓
CloudFront + AWS WAF
  ↓
ALB  (REST)              API Gateway WebSocket
  ↓                              ↓
ECS Fargate (private subnets, multi-AZ)
  ├── Auth Service
  ├── Market Data API
  ├── Order API
  └── Portfolio API
         ↓
    ElastiCache Redis (quotes, sessions, hot balances)

Order API
  ↓
Amazon SQS (or MSK if fan-out/ordering grows)
  ↓
Order Processing Service (ECS)
  ↓
Aurora PostgreSQL Multi-AZ

Events (fills, balances, ticks)
  ↓
WebSocket layer (API Gateway WebSocket → ECS fan-out)
  ↓
Users
```

## Services and why (with alternatives)

| Service | Role | Why chosen | Alternatives considered |
|---------|------|------------|-------------------------|
| **Route 53** | DNS, health-based routing | Simple, AWS-native failover to multi-AZ front door | Cloudflare DNS — fine, but keep DNS+AWS ops unified |
| **CloudFront** | TLS edge, cache public market snapshots / static web | Lowers origin load; helps p99 for cacheable GETs | Skip CDN early — worse global latency |
| **AWS WAF** | Edge allow/deny, basic rate rules | Cheap insurance at 500 RPS | Postpone WAF — unacceptable for public trading API |
| **ALB** | L7 distribute to ECS services | Path-based routing to auth/orders/portfolio/market | API Gateway HTTP API — great for authZ/throttling; ALB is simpler for many ECS services + WebSockets elsewhere |
| **API Gateway WebSocket** | Persistent client channels | Managed fan-out without running raw WS on ALB first | ALB → ECS WS — more ops; AppSync — heavier model |
| **ECS Fargate** | Containerized microservices | No EC2 patching; scale tasks independently; good cost at 500 RPS | EKS — more control, more ops tax; Elastic Beanstalk — less service isolation |
| **ElastiCache Redis** | Hot market data, session/token metadata, balance cache | Sub-ms reads for p99 budget | DynamoDB DAX / MemoryDB — overkill at this RPS |
| **SQS** | Order intake buffer | Decouples submit from process; retries/DLQ; lowest ops | **MSK (Kafka)** — better multi-consumer/ordering; adopt when stream fan-out justifies cost |
| **Aurora PostgreSQL Multi-AZ** | Orders, users, balances (source of truth) | Managed failover, good transactional fit | DynamoDB — great scale, harder multi-item balance invariants; self-managed PG — more toil |
| **CloudWatch** | Metrics, logs, alarms | Default AWS observability | Datadog/New Relic — add when team needs APM depth |
| **Auto Scaling** | ECS service + ALB target tracking | Absorb spikes without permanent over-provision | Manual capacity — fails first viral day |

### Request path (latency budget)

- Cacheable market GETs: CloudFront → Redis-backed Market Data API (often no DB).
- Order submit: ALB → Order API → enqueue SQS → **202/ack fast**; processing async.
- Portfolio reads: Portfolio API → Redis first, Aurora on miss.
- Auth: short-lived JWT/session; Redis for revoke/lists if needed.

This split keeps synchronous paths thin so **p99 < 100 ms** is realistic at 500 RPS without a co-located matching engine.

## High availability

- Multi-AZ for ALB, ECS tasks, Aurora, Redis (replica), SQS (regional).
- Aurora Multi-AZ writer + failover; app uses connection retry.
- SQS DLQ + alarm on depth/age for poison orders.
- Stateless ECS tasks; capacity across ≥2 AZs.
- CloudFront + Route 53 health checks for edge continuity.

## Cost-conscious choices at 500 RPS

- **Fargate** over always-on large EC2 fleets.
- **SQS first**, not MSK (MSK shines later).
- Single Aurora cluster (Multi-AZ), not global DB mesh.
- Redis as cache, not a second system of record.
- CloudFront caching for public market snapshots where freshness rules allow.
- Right-size Fargate CPU/memory from load tests; scale on ALB RPS / CPU / p99 latency.

## Scaling beyond 500 RPS

When growth demands it (in order):

1. **Partition services** further (read-heavy market data vs write-heavy orders).
2. **Aurora read replicas** for portfolio/history queries; keep writes on primary.
3. **Move order bus to MSK** with partitions by symbol/user for ordered consumers.
4. **Redis Cluster** for larger hot working sets.
5. **Dedicated matching / latency-critical path** on tuned **EC2 or EKS** (kernel/network control) when Fargate variance becomes the bottleneck.
6. Cell-based / shard-by-market isolation to contain blast radius.

## Explicit non-goals (this version)

Full Binance feature parity, on-prem colo matching, multi-region active-active, and custom L7 hardware. Those are later-stage when metrics prove need.
