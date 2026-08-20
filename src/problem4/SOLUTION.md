# Problem 4 — Ship It Twice

## What "production ready" means here

- **PR validation** before merge (lint, tests, security checks / build)
- **No long-lived AWS access keys** — GitHub Actions → AWS via **OIDC**
- **Least-privilege IAM** roles scoped per pipeline (S3 artifact / deploy / CloudFront)
- **GitHub Environment `production`** for deploy protection (required reviewers optional)
- **Concurrency** so PR runs cancel superseded jobs; deploys serialize per ref
- **Immutable, versioned backend artifacts** (git SHA) with health check + rollback
- **Frontend cache discipline** (long-cache hashed assets; no-cache HTML) + CloudFront invalidation
- **Pinned action majors** (`@v4`) and **secrets/vars outside source**

## Assumptions

| Assumption | Why |
|------------|-----|
| App code lives under `backend/` and `frontend/` | Challenge does not ship app source; workflows target conventional paths |
| AWS IAM OIDC provider for GitHub is already configured | Cannot create real AWS resources in this challenge |
| Secrets: `AWS_ROLE_ARN`, `EC2_INSTANCE_ID`, `BACKEND_HEALTH_URL`, `BACKEND_ARTIFACT_BUCKET`, `FRONTEND_S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID` | Injected via GitHub Environments |
| Vars: `AWS_REGION`, `FRONTEND_API_BASE_URL` | Non-secret config |
| EC2 has SSM agent, IAM instance profile, systemd unit `backend-api`, layout under `/opt/backend` | Standard SSM deploy pattern without SSH keys in CI |
| S3 website origin is private; only CloudFront serves the SPA | Production front-door pattern |
| Workflows are authored under `src/problem4/.github/workflows/` as deliverables | In a real repo they belong at repository root `.github/workflows/` |

## How the pipelines work

### Backend (`backend-ci-cd.yml`)

```
PR → validate (lint, unit tests, npm audit)
main → validate → build SHA-versioned tarball → OIDC → S3 artifact
     → SSM deploy to EC2 (releases/<sha> + current symlink)
     → health check → rollback previous release on failure
```

### Frontend (`frontend-ci-cd.yml`)

```
PR → npm ci → lint → test → build (artifact uploaded for review)
main → build → OIDC → s3 sync (immutable assets + no-cache HTML)
     → CloudFront invalidation for HTML entrypoints
```

## Deliberately left out

- Real AWS account wiring and Terraform for OIDC/IAM (described, not provisioned)
- Blue/green or canary traffic shifting (symlink + restart is enough for a single EC2)
- Full SAST/container scanning vendors (hook points noted; org-standard tools vary)
- End-to-end browser tests / visual regression
- Multi-region failover and database migrations orchestration
- Branch deploy previews (worthwhile later; not required for the stated task)

## Supporting IAM sketch (not committed as live policy)

- Trust: GitHub OIDC (`token.actions.githubusercontent.com`) limited to this repo + `environment:production` for deploy jobs
- Backend role: `s3:PutObject` on artifact prefix; `ssm:SendCommand` on the target instance; no `*` on IAM/S3
- Frontend role: `s3:PutObject`/`DeleteObject` on the SPA bucket; `cloudfront:CreateInvalidation` on one distribution ID
