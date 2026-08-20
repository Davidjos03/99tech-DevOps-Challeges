# Problem 5 — Fortify The Castle

This is **Problem 1 with security designed in**, not bolted on. Diagram: [secure-architecture.png](./secure-architecture.png).

## What changed vs Problem 1

| Area | Problem 1 | Problem 5 change | Protects against |
|------|-----------|------------------|------------------|
| Edge | CloudFront + WAF | **WAF rules + Shield Standard**; strict rate limits on auth/order paths | L7 floods, credential stuffing, basic volumetric abuse |
| TLS | Implied at edge | **TLS everywhere**: CloudFront→ALB, ALB→ECS (HTTPS), Redis/Aurora/MSK in-transit encryption | Intercept/tamper on the wire |
| Network | Private ECS | **Explicit private subnets only** for app + data; no public IPs on tasks/DB | Direct internet probing of APIs/DB |
| Data stores | Aurora/Redis | **No public DB/Redis endpoints**; SG least privilege; **KMS CMK** encryption at rest | Exfiltration, snapshot theft, casual insider access |
| Secrets | Env assumed | **Secrets Manager** (+ rotation) for DB creds, JWT keys; task role fetch only | Leaked `.env`, baked images, long-lived keys in CI |
| Identity to AWS | — | **Task IAM roles** least privilege; **CI/CD OIDC** (from Problem 4) | Static AWS keys in GitHub |
| Detection | CloudWatch | **CloudTrail**, **GuardDuty**, CloudWatch alarms on 5xx/auth failures/DLQ | Account misuse, malware, silent failure |
| Supply chain | — | **Image scanning** (ECR) + dependency audit in CI | Known CVEs shipping to prod |
| Finance ops | — | **Immutable audit trail** for order/balance mutations (append-only table or signed events) | Disputes, insider fraud, non-repudiation gaps |
| Backups | Implied Multi-AZ | **Encrypted Aurora backups**, tested restore runbook | Ransomware / regional corruption scenarios |

```
Internet
  ↓
Route 53
  ↓
CloudFront
  ↓
AWS WAF + Shield
  ↓
ALB (TLS, private targets)
  ↓
Private subnets — ECS Fargate services
   ├─ Task IAM roles (least privilege)
   ├─ Secrets Manager
   └─ KMS-encrypted volumes / env materialization
  ↓
Aurora / Redis / SQS|MSK — private only, encrypted, tight SGs
  ↓
CloudTrail + GuardDuty + CloudWatch (detect & alert)
```

## Priorities (what we secure first)

1. **TLS + private data plane + no public DB** — without these, nothing else matters.
2. **Secrets Manager + IAM least privilege + OIDC CI/CD** — stop credential leaks.
3. **WAF/rate limits on auth & order submit** — trading APIs are abuse magnets.
4. **Encryption at rest (KMS) + encrypted backups** — regulatory and breach containment.
5. **Audit trail for financial mutations** — business-critical for a trading system.
6. **GuardDuty + CloudTrail + alerts** — assume prevention fails; detect fast.

## Acceptable risk (deliberately deferred)

| Deferred | Trade-off |
|----------|-----------|
| AWS Shield Advanced | Costly at 500 RPS; Standard + WAF + scaling sufficient initially |
| Multi-region active-active | Huge complexity; Multi-AZ + backups first |
| Customer-managed HSM | CloudHSM later if compliance demands; KMS CMK OK now |
| Full zero-trust service mesh (mTLS everywhere) | Start with SG + TLS to ALB/targets; mesh when service count explodes |
| Formal pentest before every release | Require before GA; continuous scanning earlier |

## Refuse to ship without

- TLS on all external and service-to-data connections  
- Encryption at rest for Aurora (and Redis if storing sensitive material)  
- Private database/cache access (no public endpoints)  
- Secrets Manager (or equivalent) — no secrets in images/repo  
- Least-privilege IAM for tasks and CI (OIDC, not access keys)  
- Audit logging for order/balance changes + CloudTrail on the account  
- Encrypted backups with a tested restore path  
- Basic WAF / rate limiting on public auth and order endpoints  

## Facts I would still need (and interim assumptions)

| Need | How to get it | Assumed meanwhile |
|------|---------------|-------------------|
| Exact compliance regime (e.g. local financial regs) | Legal / security questionnaire | Treat as “internet-facing financial API” baseline |
| Threat model for insider access | Org security workshop | Prefer private subnets + audit over trust-on-first-use |
| RPO/RTO targets | Business continuity owners | Aurora automated backup + Multi-AZ failover |
| WAF false-positive budget | Prod traffic baselines | Start count-based rate limits; tune with logs |

## What stayed from Problem 1

ECS Fargate service split, ALB path routing, Redis hot path, SQS-first async orders, Aurora system of record, CloudFront edge — **same topology**, hardened networking, identity, encryption, and detection.
