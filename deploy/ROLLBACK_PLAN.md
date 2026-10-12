# CARNO PLATFORM — PRODUCTION ROLLBACK RUNBOOK & PROCEDURES

This document defines the authoritative, executable rollback strategy for Carno production deployments across both Docker Compose and Systemd/VM architectures.

---

## 1. Governance & Authorization

* **Authorization:** A production rollback may only be initiated by the Lead Reliability Engineer or designated Incident Commander upon detecting:
  * Persistent HTTP 5xx error rate > 1% on `/api/*` routes.
  * Worker crash loops or failure to establish authenticated Redis connection.
  * Memory leak or unbounded PostgreSQL connection consumption.
* **Database & Data Preservation:** 
  * **NEVER** run `docker compose down -v`.
  * **NEVER** drop, truncate, or recreate PostgreSQL databases (`carlanding`).
  * **NEVER** delete or format the named Redis volume (`redis_data`).

---

## 2. Release Versioning & Rollback Preparation

Every deployment MUST be tagged with an immutable identifier (Git commit SHA or semantic release tag). 
Example image tags:
* Current release: `carno-app:${GIT_SHA}`
* Previous release: `carno-app:${PREVIOUS_GIT_SHA}`

A symlink or tag alias `carno-app:previous` must be maintained immediately before applying any new deployment.

---

## 3. Rollback Execution Procedures

### Option A: Docker Compose Architecture

When the deployment is orchestrated via Docker Compose:

1. **Capture Evidence (Pre-Rollback State):**
   ```bash
   # Capture container logs and failure diagnostics
   docker compose logs --tail=200 app > /var/log/carno/rollback-app-pre.log
   docker compose logs --tail=200 worker > /var/log/carno/rollback-worker-pre.log
   npm run ops:check > /var/log/carno/rollback-ops-pre.json
   ```

2. **Rollback Container Images to Previous SHA:**
   ```bash
   # Export previous release SHA
   export DEPLOY_TAG=${PREVIOUS_GIT_SHA}

   # Re-launch containers using previous release images without touching volumes
   docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --no-deps app worker
   ```

3. **Verify Clean Shutdown & Startup:**
   ```bash
   # Confirm worker restarted with concurrency 1 and connected to Redis
   docker compose logs --tail=50 worker
   # Look for: [SMS_WORKER_READY] Worker loop started. Listening for SMS dispatch jobs...
   ```

---

### Option B: Bare-Metal / VM (Systemd Architecture)

When deployed directly on a Linux host using release directories and Systemd:

1. **Capture Diagnostic State:**
   ```bash
   journalctl -u carno-sms-worker -n 100 --no-pager > /var/log/carno/worker-pre-rollback.log
   ```

2. **Switch Release Symlink:**
   ```bash
   # Point active symlink to previous release
   ln -sfn /var/www/carno/releases/${PREVIOUS_GIT_SHA} /var/www/carno/current
   ```

3. **Restart Worker & Web Services:**
   ```bash
   # Gracefully reload/restart worker and Next.js service
   sudo systemctl restart carno-sms-worker
   sudo systemctl restart carno-web
   ```

---

## 4. Post-Rollback Verification & Health Checks

Run the automated operational check to confirm platform restoration:

```bash
cd /var/www/carno/current && npm run ops:check
```

Verify that:
1. `status` is `"OK"` (or expected `"WARN"` if queue backlog accumulated during the incident).
2. `redis.status` is `"CONNECTED"`.
3. `postgres.status` is `"CONNECTED"` and `carnoAppConnections` $\le 15$.
4. Worker logs confirm claims are being dispatched sequentially:
   ```bash
   journalctl -u carno-sms-worker -f
   ```

---

## 5. Database & State Compatibility Guarantee

* **Backward Compatibility:** All Prisma migrations and C1–C4 schema additions are backward-compatible. No columns or tables were removed. The previous code revision can safely read and write to the existing PostgreSQL database.
* **Queue In-Flight Retention:** The queue engine is atomic; jobs claimed during the failed release whose leases expired are automatically reaped by the worker's internal reaper loop within 15–45 seconds and requeued without message loss.
