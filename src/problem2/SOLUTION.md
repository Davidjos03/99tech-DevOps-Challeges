# Problem 2 — Diagnose Me Doctor

**Host:** Ubuntu 24.04 VM, 64 GB disk, **~99% full**  
**Role:** NGINX load balancer / traffic router only

## Investigation sequence

```bash
# 1. Confirm capacity vs inodes
df -h
df -i

# 2. Find which mount and top-level directories grew
sudo du -xhd1 / | sort -h
sudo du -xhd1 /var | sort -h
sudo du -xhd1 /var/log | sort -h

# 3. Log and journal pressure
sudo du -sh /var/log/*
sudo journalctl --disk-usage
sudo journalctl --vacuum-size=200M   # only after confirming journal is huge

# 4. Deleted-but-open files (classic "df full, du doesn't add up")
sudo lsof +L1

# 5. If NGINX is containerized
docker system df
sudo du -sh /var/lib/docker/containers/*/*-json.log 2>/dev/null | sort -h

# 6. Cores / temp / uploads
sudo find /var/crash /tmp /var/tmp -type f -size +100M 2>/dev/null
```

Primary hypothesis for this role: **NGINX access/error logs growing without effective rotation**, often combined with **deleted logs still held open** by the master/worker.

---

## Root causes (cause → impact → diagnosis → recovery → prevention)

### 1. NGINX logs without rotation (most likely)

| | |
|--|--|
| **Cause** | `/var/log/nginx/access.log` (and error log) grow unbounded; logrotate missing, misconfigured, or NGINX not signaled to reopen |
| **Impact** | Disk hits 99%; risk of write failures, failed log writes, unstable routing host |
| **Diagnosis** | `sudo du -sh /var/log/nginx/*`; check `/etc/logrotate.d/nginx`; `grep error /var/log/nginx/error.log \| tail` |
| **Immediate recovery** | Truncate or rotate safely: `sudo sh -c ':> /var/log/nginx/access.log'` **or** `sudo logrotate -f /etc/logrotate.d/nginx` then `sudo nginx -s reopen` |
| **Prevention** | Working logrotate (`daily`/`size`, `postrotate` → `nginx -s reopen`); ship logs to remote (CloudWatch/Fluent Bit); alert at 70/85% disk |

### 2. systemd journal growth

| | |
|--|--|
| **Cause** | Persistent journal unbounded under `/var/log/journal` |
| **Impact** | Same disk pressure; masks application log issues |
| **Diagnosis** | `sudo journalctl --disk-usage`; `du -sh /var/log/journal` |
| **Immediate recovery** | `sudo journalctl --vacuum-size=200M` or `--vacuum-time=7d` |
| **Prevention** | `SystemMaxUse=` in `/etc/systemd/journald.conf`; monitoring on journal size |

### 3. Deleted files still held open (often NGINX)

| | |
|--|--|
| **Cause** | Logs deleted/truncated incorrectly; NGINX workers still write to unlinked inodes |
| **Impact** | `df` shows full; `du` looks smaller — space not reclaimed until process closes FD |
| **Diagnosis** | `sudo lsof +L1` shows large deleted nginx log FDs |
| **Immediate recovery** | `sudo nginx -s reopen` or reload/restart NGINX after proper truncate/rotate |
| **Prevention** | Always reopen via logrotate `postrotate`; never only `rm` active logs |

### 4. Docker/container json logs (if NGINX is containerized)

| | |
|--|--|
| **Cause** | Default Docker json-file driver unlimited |
| **Impact** | `/var/lib/docker` fills the root volume |
| **Diagnosis** | `docker system df`; large `*-json.log` under containers |
| **Immediate recovery** | Truncate json logs; restart container; prune unused data carefully |
| **Prevention** | `log-opts max-size/max-file` daemon-wide; or Loki/journald drivers |

### 5. Core dumps / temp files

| | |
|--|--|
| **Cause** | Process crashes writing cores; leftover `/tmp` artifacts |
| **Impact** | Sudden jumps in usage |
| **Diagnosis** | `du` on `/var/crash`, `/tmp`; `ulimit -c` / coredump config |
| **Immediate recovery** | Remove confirmed old cores/temp after incident review |
| **Prevention** | Limit core size; clear tmp via systemd-tmpfiles; alert on `/var/crash` |

### 6. Inode exhaustion

| | |
|--|--|
| **Cause** | Millions of tiny files (cache, temp), not large logs |
| **Impact** | `df -h` may look OK-ish while creates fail; `df -i` at 100% |
| **Diagnosis** | `df -i`; find directories with huge file counts |
| **Immediate recovery** | Delete stale small-file trees; fix the writer |
| **Prevention** | Monitor inodes; avoid unbounded on-disk caches on the LB host |

### 7. Abnormal traffic → huge access logs

| | |
|--|--|
| **Cause** | Bot flood / attack / misconfigured client amplifying request volume |
| **Impact** | Log volume spikes; disk fills; CPU on log I/O |
| **Diagnosis** | Spike in access.log growth rate; top IPs/paths via `cut`/`goaccess` |
| **Immediate recovery** | Rotate/reopen logs; rate-limit / block at WAF/security group; scale or shed |
| **Prevention** | Edge WAF/rate limits; sample or drop verbose access logs; remote logging |

---

## Recommended incident order for this VM

1. `df -h` / `df -i`  
2. `du` on `/var/log` and `/var/log/nginx`  
3. `lsof +L1` for deleted-open logs  
4. Rotate + `nginx -s reopen`  
5. Confirm free space and NGINX health  
6. Fix logrotate + add disk alarms + remote log shipping so it cannot silently recur  
