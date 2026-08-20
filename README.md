# 99Tech DevOps Challenge

Solutions for all five problems live under `src/`. Do **not** fork the upstream template publicly if your submission should stay unlinked.

## Problems

| Problem | Path | Deliverable |
|---------|------|-------------|
| 1 Building Castle In The Cloud | [`src/problem1`](./src/problem1) | Architecture + diagram |
| 2 Diagnose Me Doctor | [`src/problem2`](./src/problem2) | Disk troubleshooting runbook |
| 3 Debugging issues within system | [`src/problem3`](./src/problem3) | Fixed Compose stack + report |
| 4 Ship It Twice | [`src/problem4`](./src/problem4) | GitHub Actions workflows + report |
| 5 Fortify The Castle | [`src/problem5`](./src/problem5) | Secured architecture + diagram |

## Quick verify (Problem 3)

```bash
cd src/problem3
docker compose up --build
curl -s http://localhost:8080/
curl -s http://localhost:8080/status
curl -s http://localhost:8080/api/users
```
