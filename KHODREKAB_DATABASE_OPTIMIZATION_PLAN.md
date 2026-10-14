# CARNO DATABASE & DATA LAYER OPTIMIZATION PLAN (FINAL REVISED v6)
## Production-Grade Architecture, Concurrency, and Migration Strategy (Phase B)

**Project:** Carno / کارنو  
**Phase:** Phase B — Database Optimization Plan  
**Target:** PostgreSQL 16 / Prisma 5.22 / Redis 7 / Node.js Next.js 16  
**Status:** Pre-C0 Gated Draft — Awaiting Final Gate 2 Authorization  
**Execution Scope:** Strictly Planning & Architecture. Zero schema, code, migration, or configuration modifications permitted in this phase.

---

## 1. Executive Overview & Plan Objectives

Following the approval of [CARNO_DATABASE_AUDIT.md](file:///Users/mahdi/Documents/DivarLanding/CARNO_DATABASE_AUDIT.md) and incorporation of all Gate 2 human review directives (including all v6 blockers and hardenings), this implementation plan outlines the exact technical standards for Phase C implementation.

### Core Approved Principles:
1. **Full Object Ownership & Dedicated Shadow Database for Migration Role:** `carno_migrator` will take full DDL ownership of all tables, sequences, enums, and views in `public` via explicit ownership reassignment from `postgres` executed as admin, without granting superuser rights (`CREATEROLE` / `CREATEDB`). To enable `prisma migrate dev` (even with `--create-only`) under a least-privilege `carno_migrator` lacking `CREATEDB`, a dedicated shadow database `carlanding_shadow` is explicitly provisioned and owned by `carno_migrator`.
2. **Explicit Separation of Migration, Shadow, and Runtime Credentials:** Gate C0 and all migration operations execute strictly via `MIGRATION_DATABASE_URL` targeting `carlanding` and `SHADOW_DATABASE_URL` targeting `carlanding_shadow` (`carno_migrator`), while runtime web queries use `DATABASE_URL` (`carno_app`).
3. **Waitlist Index Reality:** Composite indexing on `WaitlistEntry` enables index-backed execution plans ($O(K)$), but does not guarantee memory residency or $O(1)$ complexity. Actual plan selection will be validated with `EXPLAIN (ANALYZE, BUFFERS)`.
4. **Collision-Safe Payment Code Allocation & Unified Quarantine Lifecycle:** Transitioning in Phase C1 to a true PostgreSQL partial unique index `UNIQUE (uniqueCode) WHERE status = 'PENDING'`. The obsolete `@@unique([uniqueCode, status])` constraint is explicitly removed from `schema.prisma`. Payment codes (1–999) are reusable and sustainable: upon payment confirmation, codes enter a **24-hour Post-Paid Quarantine Cooldown**; upon expiration, codes enter a **30-minute Expired Quarantine Cooldown** (tracked by dedicated `expiredAt DateTime?`). The 30-minute window is defined as a precautionary **Risk Budget / Business Policy** (not an empirical fact or operator latency guarantee), to be calibrated against live telemetry. PostgreSQL `CHECK` constraints guarantee code bounds (1–999) and exact total amount binding.
5. **Approved Webhook Idempotency (Option B with Exactly-One Invariant & Error Decoupling):** Option B provides atomic duplicate-confirmation protection for an active PaymentIntent. Deterministic intent resolution binds `totalAmount` to the single active `PENDING` intent without using `LIMIT 1`, strictly asserting the exactly-one invariant (0 rows $\to$ HTTP 200 IGNORED; 1 row $\to$ atomic transaction; $>1$ rows $\to$ critical integrity alert & HTTP 500 fail-closed). Infrastructure errors (database timeout, connection failure, transaction abort) are strictly decoupled from semantic non-matches and return HTTP 5xx so webhook callers (n8n) retain retry capabilities. Provider `referenceId` (`sms-${Date.now()}`) is treated strictly as unverified metadata.
6. **Dual-Tier Retention Pruning with Dedicated Indexes:** OTP maintenance pruning operates on `createdAt` with dedicated retention index support (distinguished from runtime `phone` auth lookups), cleaning both expired unverified challenges (24h) and consumed challenges (7d).
7. **Semantic Integrity on Redis Failure (Blocker Resolution):** Redis queue dispatch failures will **never** set `verified = true`. Challenges are invalidated by expiring them (`expiresAt = NOW()`) with `verified = false`, preserving database audit truth and matching retention boundaries.
8. **Realistic Connection Budgeting:** Hard ceiling of $\le 40$ connections for application pools, preserving $\ge 52\%$ of PostgreSQL capacity for failover and operational headroom.
9. **Strict Gate Governance & Safe Migrations:** Phase C is partitioned into 6 discrete, sequential gates (C0 through C5, plus Phase D) with mandatory human review stop gates between every stage. C0 enforces genuine schema drift validation (`--from-url`), shadow database verification, and an unmanaged object catalog inventory. C1 enforces live uniqueness preflight checks, database CHECK constraints, schema cleanup, and non-interactive `--create-only` + `migrate deploy` execution.

---

## 2. Topic 1: Database Roles & Object Ownership Architecture

### 2.1 Problem Statement & PostgreSQL Ownership Invariants
1. The application currently connects as the PostgreSQL superuser `postgres`.
2. Granting `USAGE, CREATE ON SCHEMA public` to `carno_migrator` is **insufficient** because existing tables are owned by `postgres`. In PostgreSQL, non-superusers cannot execute `ALTER TABLE`, `DROP TABLE`, or `CREATE/DROP INDEX` on objects they do not own, even if granted `ALL PRIVILEGES` on the schema.
3. `ALTER DEFAULT PRIVILEGES` only configures access permissions on *future* objects created by a specified role; it does **not** transfer ownership of existing tables, nor does it grant DDL rights like `ALTER TABLE` to non-owners.
4. Furthermore, Prisma `migrate dev` (even with `--create-only`) requires a shadow database. By default on PostgreSQL, Prisma attempts to dynamically create and drop this shadow database, which requires `CREATEDB` or superuser privileges. Because `carno_migrator` is intentionally restricted with **NO CREATEDB**, running `migrate dev` would fail without a pre-existing, dedicated shadow database.
5. In PostgreSQL, schema permissions aggregate from the pseudo-role `PUBLIC`. Simply revoking `CREATE` from `carno_app` is insufficient if `PUBLIC` retains `CREATE` on schema `public`. To enforce true least-privilege, `CREATE ON SCHEMA public` must be explicitly revoked from `PUBLIC` as well.
6. Therefore, explicit database-level object ownership transfer, shadow database provisioning, and `PUBLIC` privilege revocation must be executed once as superuser before any migration operations can succeed under `carno_migrator`.

### 2.2 Role Separation & Ownership Transfer Protocol

```text
               [ PostgreSQL 16 Server ]
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
 [ Target DB: carlanding ]     [ Shadow DB: carlanding_shadow ]
          │                               │
          │ (carno_migrator: Owner)       │ (carno_migrator: Owner)
          │ (carno_app: DML Only)         │ (Full DDL rights for diffing)
          │                               │
   MIGRATION_DATABASE_URL           SHADOW_DATABASE_URL
```

#### Step 1: Migration Role Creation, Shadow Database Setup & Full Ownership Reassignment (Executed Once as Superuser `postgres`)
```sql
-- 1. Create migration role with scoped privileges (strictly NO CREATEROLE, NO CREATEDB)
CREATE ROLE carno_migrator WITH LOGIN PASSWORD '<SECURE_MIGRATOR_PASSWORD>';
GRANT CONNECT ON DATABASE carlanding TO carno_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO carno_migrator;

-- 2. Provision dedicated Shadow Database for Prisma Migrations
--    Prisma migrate dev requires a shadow database to calculate schema diffs.
--    By provisioning a dedicated shadow database owned by carno_migrator, Prisma uses it
--    directly via shadowDatabaseUrl without needing cluster-level CREATEDB or superuser rights!
CREATE DATABASE carlanding_shadow OWNER carno_migrator;
GRANT ALL PRIVILEGES ON DATABASE carlanding_shadow TO carno_migrator;

-- 3. Explicitly transfer public schema ownership in target database (carlanding)
ALTER SCHEMA public OWNER TO carno_migrator;

-- 4. Reassign ownership of ALL existing tables, sequences, enums, and views from postgres to carno_migrator
--    (In PostgreSQL, ALTER TABLE/DROP TABLE requires object ownership, not merely GRANT privileges)
DO $$ 
DECLARE 
  r RECORD;
BEGIN
  -- Reassign all existing tables in public schema
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO carno_migrator;';
  END LOOP;

  -- Reassign all existing sequences in public schema
  FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
    EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequence_name) || ' OWNER TO carno_migrator;';
  END LOOP;

  -- Reassign all existing custom enums (UserStatus, PaymentStatus, ReferralStatus, etc.)
  FOR r IN (SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e') LOOP
    EXECUTE 'ALTER TYPE public.' || quote_ident(r.typname) || ' OWNER TO carno_migrator;';
  END LOOP;

  -- Reassign any existing views
  FOR r IN (SELECT table_name FROM information_schema.views WHERE table_schema = 'public') LOOP
    EXECUTE 'ALTER VIEW public.' || quote_ident(r.table_name) || ' OWNER TO carno_migrator;';
  END LOOP;
END $$;

-- 5. Verification Check: Confirm that 100% of public tables and sequences are owned by carno_migrator
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public';
SELECT sequence_name, sequence_owner FROM information_schema.sequences WHERE sequence_schema = 'public';
```

> [!IMPORTANT]
> **Why `ALTER DEFAULT PRIVILEGES ... GRANT ALL TO carno_migrator` is eliminated:**  
> `ALTER DEFAULT PRIVILEGES` only grants access privileges on *future* objects; it does **not** transfer object ownership on existing tables, nor does it grant DDL rights like `ALTER TABLE` / `DROP TABLE` to non-owners. By explicitly altering the owner of every existing table, sequence, and type to `carno_migrator`, and having `carno_migrator` run all future Prisma migrations, all present and future database objects are natively owned by `carno_migrator`.

#### Step 2: Runtime Role Creation (`carno_app`) & Hardened Least-Privilege DDL Lockdown
```sql
CREATE ROLE carno_app WITH LOGIN PASSWORD '<SECURE_APP_PASSWORD>';
GRANT CONNECT ON DATABASE carlanding TO carno_app;
GRANT USAGE ON SCHEMA public TO carno_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO carno_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO carno_app;

-- Configure default privileges: Any future table/sequence created by carno_migrator automatically grants DML to carno_app
ALTER DEFAULT PRIVILEGES FOR ROLE carno_migrator IN SCHEMA public 
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO carno_app;

ALTER DEFAULT PRIVILEGES FOR ROLE carno_migrator IN SCHEMA public 
GRANT USAGE, SELECT ON SEQUENCES TO carno_app;

-- Strictly forbid DDL for runtime application:
-- CRITICAL SECURITY RULE: PostgreSQL aggregates privileges from PUBLIC.
-- If CREATE on schema public is not revoked from PUBLIC, carno_app inherits CREATE from PUBLIC!
-- Therefore, we must explicitly revoke CREATE from both PUBLIC and carno_app:
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM carno_app;
GRANT USAGE ON SCHEMA public TO carno_app;
GRANT USAGE, CREATE ON SCHEMA public TO carno_migrator;

-- Verification Assertion: Confirm carno_app has zero schema creation/modification privileges
SELECT has_schema_privilege('carno_app', 'public', 'CREATE');
-- MUST return 'f' (false)
```

#### Step 3: Explicit Credential Mapping & Operational Separation
- **Application Runtime (`DATABASE_URL` in `.env`):**
  Used exclusively by Next.js application runtime, server actions, background workers, and API routes.
  ```text
  DATABASE_URL="postgresql://carno_app:<SECURE_APP_PASSWORD>@localhost:5433/carlanding?schema=public&connection_limit=10&pool_timeout=10&connect_timeout=5"
  ```
- **Migrations & Target DDL Operations (`MIGRATION_DATABASE_URL`):**
  Used exclusively during CI/CD, Prisma migrations, baseline resolution, and schema deployments targeting the primary database `carlanding`.
  ```text
  MIGRATION_DATABASE_URL="postgresql://carno_migrator:<SECURE_MIGRATOR_PASSWORD>@localhost:5433/carlanding?schema=public"
  ```
- **Prisma Shadow Database Connection (`SHADOW_DATABASE_URL`):**
  Used exclusively by Prisma during development and migration diffing (`migrate dev --create-only`), targeting dedicated `carlanding_shadow`.
  ```text
  SHADOW_DATABASE_URL="postgresql://carno_migrator:<SECURE_MIGRATOR_PASSWORD>@localhost:5433/carlanding_shadow?schema=public"
  ```
- **Prisma Schema Datasource Declaration (`prisma/schema.prisma`):**
  ```prisma
  datasource db {
    provider          = "postgresql"
    url               = env("DATABASE_URL")
    shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
  }
  ```

> [!CRITICAL]
> 1. `carno_app` has `REVOKE CREATE ON SCHEMA public` and cannot modify schemas. Any attempt to run `prisma migrate` or `prisma db push` using `DATABASE_URL` will fail with permission denied. All Prisma migration commands MUST be invoked by explicitly passing `DATABASE_URL="$MIGRATION_DATABASE_URL"`.
> 2. With `shadowDatabaseUrl` explicitly defined, Prisma never attempts to execute `CREATE DATABASE` / `DROP DATABASE`, completely resolving the contradiction with `carno_migrator` having no `CREATEDB` privilege.

---

## 3. Topic 2: Waitlist Ranking Architecture & Scalability

### 3.1 Reality of PostgreSQL B-Tree Indexing on COUNT
- **Measured Baseline (Phase A):** On the current 25-row table, `EXPLAIN (ANALYZE, BUFFERS)` reveals a `Seq Scan on "WaitlistEntry"` executing in **0.659ms** (planning: 3.217ms, shared hit: 1 buffer page).
- **Index Characteristic:** Adding a composite B-tree index `("priorityScore" DESC, "joinedAt" ASC)` allows PostgreSQL to consider index-backed execution plans (`Index Scan` or `Bitmap Index Scan`).  
  **CRITICAL CLARIFICATION:** A standard PostgreSQL B-tree index does **NOT** store subtree cardinality counts. Therefore, evaluating:
  ```sql
  SELECT COUNT(*) FROM "WaitlistEntry"
  WHERE ("priorityScore" > :score) OR ("priorityScore" = :score AND "joinedAt" < :joinedAt);
  ```
  remains an **$O(K)$ operation**, where $K$ is the number of matching tuples (the user's position in the waitlist). It is **not** an $O(1)$ query.
- **Accurate Buffer & Plan Reality:**  
  The composite index enables PostgreSQL to consider index-backed execution plans and is expected to reduce scanned data under the target workload; actual plan selection must be validated with `EXPLAIN (ANALYZE, BUFFERS)`. Buffer cache residency is **not** guaranteed by an index alone and depends on cache sizing, table churn, and memory pressure.
- **Index as Immediate Mitigation (Phase C):**  
  The composite index enables PostgreSQL to consider index-backed execution plans and is expected to reduce scanned data under the target workload; actual plan selection must be validated with `EXPLAIN (ANALYZE, BUFFERS)`. It provides immediate mitigation up to an [ANALYTICAL PROJECTION - UNBENCHMARKED] range of ~25,000–30,000 rows under moderate load, but is an immediate mitigation, **not** an $O(1)$ final state.

### 3.2 Future Derived Ranking Layer (Redis ZSET Roadmap & Freshness Policy)
- **PostgreSQL Remains Canonical Source of Truth:** All user registrations, priority scores, and referral states originate and persist in PostgreSQL.
- **Redis ZSET Status:** Categorized strictly as a **future scale phase**.
- **Freshness & Versioning Policy:**  
  A merely existing Redis key does **not** guarantee real-time rank accuracy. Without an explicit reconciliation and versioning mechanism (e.g., `waitlist:rank:version` epoch counter updated atomically on score changes, paired with dirty-flag invalidation), serving reads from Redis risks presenting stale or out-of-order ranks.
- **Phase C Decision:** Until an explicit versioned reconciliation pipeline is built and validated under load testing, **PostgreSQL remains the primary and exact source of truth for all ranking lookups** backed by the new composite index.

---

## 4. Topic 3: Payment Code Allocation (1–999) & Constraint Realities

### 4.1 Accurate Constraint Documentation & Schema/SQL Separation
- **Current Prisma Schema:**
  ```prisma
  @@unique([uniqueCode, status])
  ```
- **Current PostgreSQL Index:**
  ```sql
  CREATE UNIQUE INDEX "PaymentIntent_uniqueCode_status_key" ON "PaymentIntent" ("uniqueCode", status);
  ```
- **Technical Implication & Flaw:**  
  The current constraint is a standard multi-column unique constraint on `("uniqueCode", status)`. It is **NOT** a partial index (`WHERE status = 'PENDING'`).  
  - *Risk:* Under the current constraint, two rows with `uniqueCode = 5, status = 'EXPIRED'` will collide and throw a `P2002` error because `(5, 'EXPIRED')` can only exist once!
- **True Business Requirement:**  
  Only **one active `PENDING` intent** may occupy a given code at a time. Multiple historical `EXPIRED`, `PAID`, or `FAILED` intents must be permitted for the same code.
- **Architectural Solution & Schema Governance (Phase C1 Migration):**  
  1. **Prisma Schema (`schema.prisma`):**  
     **Remove `@@unique([uniqueCode, status])` from `schema.prisma`.**  
     In Prisma 5.22, partial indexes (`WHERE ...`) cannot be represented natively in the Prisma Schema Language (PSL). Leaving `@@unique([uniqueCode, status])` in `schema.prisma` would cause future Prisma migrations to attempt to resurrect the obsolete composite constraint.
     ```text
     Prisma schema  ──► does NOT declare the obsolete composite unique
     Migration SQL  ──► owns and declares the PostgreSQL partial unique index
     ```
  2. **Dedicated Expiration Timestamp (`expiredAt`):**  
     Add `expiredAt DateTime?` to `model PaymentIntent` in `schema.prisma` to cleanly record the exact transition moment to `EXPIRED`, eliminating reliance on overloaded `updatedAt`.
  3. **PostgreSQL Partial Unique Index (`migration.sql`):**  
     ```sql
     DROP INDEX IF EXISTS "PaymentIntent_uniqueCode_status_key";
     CREATE UNIQUE INDEX "PaymentIntent_uniqueCode_pending_key" 
     ON "PaymentIntent" ("uniqueCode") 
     WHERE status = 'PENDING';
     ```
  4. **PostgreSQL CHECK Constraints (`migration.sql`):**  
     To prevent reliance solely on application code for data integrity, enforce mathematical invariants at the storage engine level:
     ```sql
     ALTER TABLE "PaymentIntent" 
       ADD CONSTRAINT "check_payment_intent_unique_code_range" 
       CHECK ("uniqueCode" >= 1 AND "uniqueCode" <= 999);

     ALTER TABLE "PaymentIntent" 
       ADD CONSTRAINT "check_payment_intent_total_amount_calc" 
       CHECK ("totalAmount" = 299000 + "uniqueCode");
     ```

### 4.2 Collision-Safe Allocation Architecture (Bounded Candidate Selection + Atomic Retry)

#### Step 1: Active Sweep (Idempotent Expiration with Dedicated `expiredAt`)
Before evaluating available codes, stale pending intents are transitioned to `EXPIRED`:
```sql
UPDATE "PaymentIntent"
SET "status" = 'EXPIRED', "expiredAt" = NOW(), "updatedAt" = NOW()
WHERE "status" = 'PENDING' AND "expiresAt" < NOW();
```

#### Step 2: Sustainable Lifecycle with Dual-Tier Quarantine Policy
To resolve the contradiction of pool exhaustion (permanently consuming codes exhausts the 1–999 pool after 999 users) while strictly protecting against delayed or duplicate bank SMS collisions:
- **`PAID` codes are reusable** after a **24-hour Post-Paid Quarantine Cooldown** (from `confirmedAt`), ensuring late duplicate bank webhook delivery cannot collide with newly issued intents.
- **`EXPIRED` codes are reusable** after a **30-minute Expired Quarantine Cooldown** (from `expiredAt`), chosen as a precautionary **Risk Budget / Business Policy** (calibrated against live telemetry).

```text
[ UNALLOCATED / REUSABLE POOL (1–999) ]
              │
              ▼ (Allocate candidate code 1–999)
         [ PENDING ] (active checkout, expires in 15m)
              │
              ├── (Paid via Webhook) ──► [ PAID ]
              │                             │
              │                             ▼
              │                  [ POST-PAID QUARANTINE ] (24h cooldown window)
              │                             │
              │                             ▼ (after 24h)
              │                  [ REUSABLE POOL ]
              │
              └── (Timeout without payment) ──► [ EXPIRED ]
                                                    │
                                                    ▼
                                         [ EXPIRED QUARANTINE ] (30m Risk Budget window)
                                                    │
                                                    ▼ (after 30m)
                                         [ REUSABLE POOL ]
```

Candidate selection query excluding active pending intents, quarantined expired codes, AND post-paid quarantined codes:
```sql
WITH quarantined_or_active_codes AS (
    -- 1. Actively pending codes
    SELECT "uniqueCode"
    FROM "PaymentIntent"
    WHERE "status" = 'PENDING' AND "expiresAt" > NOW()

    UNION

    -- 2. Recently expired codes under quarantine cool-down window (30-minute Risk Budget policy)
    --    Uses dedicated expiredAt (with expiresAt fallback) instead of generic updatedAt
    SELECT "uniqueCode"
    FROM "PaymentIntent"
    WHERE "status" = 'EXPIRED' 
      AND COALESCE("expiredAt", "expiresAt") > NOW() - INTERVAL '30 minutes'

    UNION

    -- 3. Recently confirmed paid codes under post-paid quarantine cool-down window (24 hours)
    --    Protects against delayed duplicate bank SMS collisions after code reuse
    SELECT "uniqueCode"
    FROM "PaymentIntent"
    WHERE "status" = 'PAID' 
      AND "confirmedAt" > NOW() - INTERVAL '24 hours'
),
available_codes AS (
    SELECT s.code
    FROM generate_series(1, 999) AS s(code)
    WHERE s.code NOT IN (SELECT "uniqueCode" FROM quarantined_or_active_codes)
)
SELECT code
FROM available_codes
ORDER BY random()
LIMIT 1;
```

#### Step 3: Atomic INSERT with Unique-Constraint Guarded Retries
1. The application attempts to insert the `PaymentIntent` with the candidate `code`.
2. **Concurrency Safety:** If two concurrent requests select the same candidate code simultaneously, the partial unique index (`UNIQUE (uniqueCode) WHERE status = 'PENDING'`) enforces database-level mutual exclusion. Exactly one transaction succeeds; the competing transaction encounters a `P2002` constraint violation.
3. **Bounded Retry Loop:** The application catches the `P2002` error and retries the selection-and-insert sequence up to **3 times**.
4. **Pool Exhaustion Handling:** If `available_codes` returns empty (all 999 codes are actively occupied by unexpired payments), the system aborts gracefully and returns **HTTP 429 / 503** with the neutral user message:
   > **"ظرفیت درخواست‌های فعال پرداخت موقتاً تکمیل است. لطفاً کمی بعد دوباره تلاش کنید."**  
   *(Neutral message without hardcoded time intervals; clean, graceful degradation).*

---

## 5. Topic 4: Approved Webhook Idempotency Architecture (Option B — APPROVED DECISION)

### 5.1 Reality of Incoming Webhook Payload & Design Decision
Forensic audit of `n8n-payment-workflow.json` confirmed:
- `referenceId` is dynamically synthesized on the fly via `'sms-' + Date.now()`.
- **Decision:** Provider `referenceId` فعلی (`sms-${Date.now()}`) به‌عنوان idempotency key قابل اعتماد نیست و صرفاً metadata است.
- **Option A Status:** Option A (relying on extracted bank SMS reference numbers such as `شماره پیگیری` / `شماره ارجاع`) is **NOT** a dependency for production launch. There is currently zero verified empirical evidence that Iranian banking SMS gateways reliably or consistently supply tracking numbers across all card-to-card alerts. If stable reference codes become reliably extractable in the future, Option A may be layered as a secondary verification guard, but the primary production architecture does not depend on it.
- **Approved Production Architecture:** **Option B (Deterministic Intent Resolution, Atomic Status Transition & Database-Level Single Confirmation Guard) = تصمیم مصوب.**

### 5.2 Deterministic Intent Resolution (Enforcing Exactly-One Invariant)
How does the webhook deterministically resolve the exact `PaymentIntent` without an external tracking key?
- The checkout business rule assigns an integer `uniqueCode` (1–999) to each intent.
- `totalAmount = 299000 + uniqueCode`.
- Because the Phase C1 partial unique index enforces that **only ONE active intent** can exist with `status = 'PENDING'` for a given `uniqueCode`, and the PostgreSQL CHECK constraint enforces `totalAmount = 299000 + uniqueCode`, `totalAmount` is globally unique among all active intents!
- **CRITICAL HARDENING — Elimination of `LIMIT 1`:**  
  The resolution query deliberately **omits `LIMIT 1`**. Using `LIMIT 1` is dangerous because if an application bug or data anomaly were ever to create multiple active intents with the same amount, `LIMIT 1` would mask the corruption and arbitrarily select one intent at random.
- The deterministic resolution query:
  ```sql
  SELECT id, "userId", "uniqueCode", "status", "expiresAt"
  FROM "PaymentIntent"
  WHERE "totalAmount" = :parsedAmount
    AND "status" = 'PENDING'
    AND "expiresAt" > NOW();
  ```

### 5.3 Approved Production Invariant Pipeline & Error Decoupling

```text
Incoming Webhook (parsedAmount, metadata)
               │
               ▼
[ Query Active PENDING Intent (Without LIMIT 1) ]
               │
 ┌─────────────┼────────────────────────────────────────┐
 ▼ (0 Rows)    ▼ (Exactly 1 Row)                        ▼ (> 1 Rows)
[ NO MATCH ]  [ EXACT MATCH ]                  [ CRITICAL INTEGRITY ANOMALY ]
 │             │                                │
 │             ▼                                │ - Multiple active intents
 │        [ Begin Atomic Transaction ]          │   for same amount!
 │             │                                │ - Log Emergency Alert
 │             ▼                                │ - Abort immediately
 │        1. Atomic Transition:                 │
 │           UPDATE "PaymentIntent"             ▼
 │           SET "status" = 'PAID',             HTTP 500 (Fail-Closed)
 │               "confirmedAt" = NOW()          (Triggers n8n Retry / On-Call)
 │           WHERE "id" = :intentId
 │             AND "status" = 'PENDING';
 │           ├── Rows Affected == 0 ──► Rollback & Return HTTP 200 { status: "IGNORED" }
 │           └── Rows Affected == 1
 │             │
 │             ▼
 │        2. Single Confirmation Log Guard:
 │           INSERT INTO "PaymentLog" ("paymentId", "action", "metadata", "createdAt")
 │           VALUES (:intentId, 'CONFIRMED', :metadata, NOW());
 │           └── Guarded by UNIQUE INDEX ON "PaymentLog"(paymentId) WHERE action = 'CONFIRMED'
 │             │
 │             ▼
 │        3. User Account Promotion:
 │           UPDATE "User" SET "status" = 'EARLY_ACCESS', "updatedAt" = NOW()
 │           WHERE "id" = :userId;
 │             │
 │             ▼
 │        [ Commit Transaction ] ──► Return HTTP 200 { success: true }
 │
 ▼
[ Historical Intent Audit Check ]
 Query "PaymentIntent" WHERE "totalAmount" = :parsedAmount
 ├── Intent found with status = 'PAID'    ──► HTTP 200 { status: "IGNORED", reason: "ALREADY_PROCESSED" }
 ├── Intent found with status = 'EXPIRED' ──► HTTP 200 { status: "IGNORED", reason: "INTENT_EXPIRED" }
 └── No intent found at all               ──► HTTP 200 { status: "IGNORED", reason: "UNKNOWN_AMOUNT" }
```

#### Strict Decoupling: Semantic HTTP 200 vs Infrastructure HTTP 5xx
A fundamental operational requirement is that **infrastructure failures must NEVER return HTTP 200**:

| Condition / Failure Type | HTTP Status | Response Payload | n8n / Caller Action | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Active Intent Confirmed** | **200 OK** | `{ success: true, intentId: "..." }` | Finished | Payment processed cleanly |
| **Already Confirmed Duplicate** | **200 OK** | `{ success: false, status: "IGNORED", reason: "ALREADY_PROCESSED" }` | Finished (No retry) | Valid idempotency guard |
| **Expired or Unknown Intent** | **200 OK** | `{ success: false, status: "IGNORED", reason: "INTENT_EXPIRED" }` | Finished (No retry) | Valid business expiration |
| **Database Timeout / Offline** | **503 Service Unavailable** | `{ success: false, error: "DB_UNAVAILABLE", retryable: true }` | **Retry with backoff** | Transient infra failure |
| **Transaction Abort / Deadlock**| **500 Internal Error** | `{ success: false, error: "TRANSACTION_FAILED", retryable: true }`| **Retry with backoff** | Transient concurrency error |
| **Multiple Active Rows ($>1$)** | **500 Internal Error** | `{ success: false, error: "INVARIANT_VIOLATION", retryable: true }`| **Alert & Retry/Pause**| Severe data integrity alert |

### 5.4 Database Storage Guard
To guarantee at the storage layer that duplicate confirmations cannot be written even under concurrent webhook retries:
```sql
CREATE UNIQUE INDEX "PaymentLog_paymentId_confirmed_key" 
ON "PaymentLog" ("paymentId") 
WHERE action = 'CONFIRMED';
```

### 5.5 Stale Webhooks after Code Reuse & The Mandatory Quarantine Policy
> [!WARNING]
> **Stale Webhooks & Attribution Boundary Reality:**  
> **"Option B provides atomic duplicate-confirmation protection for an active PaymentIntent, but does not cryptographically distinguish a late webhook from a prior payment after uniqueCode reuse. A code-reuse quarantine policy is therefore required."**

#### The Failure Scenario without Quarantine:
1. User A initiates checkout with code 123 (`totalAmount = 299123`). User A transfers funds at minute 29, but telecom network delays the bank SMS notification by 10 minutes.
2. At minute 30, Intent A expires without confirmation (`status = 'EXPIRED'`).
3. If code 123 were immediately recycled, User B initiating checkout at minute 31 receives code 123 (`totalAmount = 299123`, `status = 'PENDING'`).
4. At minute 39, the delayed SMS for User A arrives at the webhook.
5. The webhook searches for an active pending intent with `totalAmount = 299123` and resolves **Intent B**! User B is falsely confirmed as `PAID` using User A's transfer.

#### Architectural Safety Standard (Quarantine Cooldowns):
1. **30-Minute Expired Quarantine Cooldown (Precautionary Risk Budget):** An expired code cannot be recycled until 30 minutes have elapsed since its expiration timestamp (`expiredAt > NOW() - INTERVAL '30 minutes'`).  
   *Precautionary Policy Note:* This 30-minute window is chosen as a prudent **Risk Budget / Precautionary Business Policy** and does **not** represent an empirical fact or guaranteed telecom latency upper bound. Its value must be monitored and calibrated against real-world webhook/SMS latency telemetry in production.
2. **24-Hour Post-Paid Quarantine Cooldown:** A paid code cannot be recycled until 24 hours have elapsed since confirmation (`confirmedAt > NOW() - INTERVAL '24 hours'`). This prevents stale duplicate bank SMS notifications or delayed retries from mis-attributing to a new user after code reuse.
3. **Attribution Realism:** Quarantine drastically reduces stale collision probability, but does not provide infinite cryptographic attribution over days or weeks. True cryptographic attribution requires an authentic bank tracking number (`شماره پیگیری` / `شماره ارجاع`) from SMS (Option A). Until bank SMS formats are empirically verified to provide stable reference codes in production, Option B combined with the dual-tier quarantine windows provides the highest attainable production safety.

---

## 6. Topic 5: Comprehensive OTP Retention & Pruning Strategy

### 6.1 Problem Statement
The current codebase marks challenges as `verified = true`, but never purges them. Deleting only unverified challenges (`verified = false`) is insufficient because consumed challenges accumulate indefinitely, leading to continuous table and index bloat over time.

### 6.2 Dual-Tier Retention Boundary Specification
1. **Unverified Historical Challenges (`verified = false`):**
   - Authentication lifecycle: 5 minutes (`expiresAt`).
   - Retained for **24 hours** from `createdAt` for diagnostic, rate-limiting, and brute-force forensics, then permanently purged.
2. **Verified Historical Challenges (`verified = true`):**
   - Authentication lifecycle: Consumed immediately upon session grant.
   - Retained for **7 days** from `createdAt` (sufficient for security audit reconciliation against active user sessions), then permanently purged.

### 6.3 Dedicated Retention Index Architecture (Clarifying "Index Support")
To prevent the maintenance pruning queries from performing full-table scans, dedicated retention indexing is required.

> [!IMPORTANT]
> **Disentangling Hot Auth Lookups from Retention Pruning:**  
> - The hot runtime verification index is `("phone", "createdAt" DESC) WHERE verified = false`. Because its leading column is `phone`, it **cannot** be utilized for global retention deletes that filter purely across all phone numbers by `createdAt`.  
> - "Index Support" in the context of OTP maintenance refers strictly to **dedicated retention indexes on `createdAt`**.

**Candidate Retention Index Architectures (Phase C1 Evaluation):**
- **Option 1 (Two Partial B-Tree Indexes on `createdAt`):**
  ```sql
  CREATE INDEX "OTPVerification_unverified_retention_idx" 
  ON "OTPVerification" ("createdAt") 
  WHERE verified = false;

  CREATE INDEX "OTPVerification_verified_retention_idx" 
  ON "OTPVerification" ("createdAt") 
  WHERE verified = true;
  ```
  *Technical Basis:* Two partial indexes separate verified and unverified retention scans, allowing each DELETE statement to use a targeted `createdAt` range without index cross-talk.
- **Option 2 (Single Composite B-Tree Index):**
  ```sql
  CREATE INDEX "OTPVerification_retention_composite_idx" 
  ON "OTPVerification" ("verified", "createdAt");
  ```
  *Technical Basis:* Single composite index covering both status branches in index range scans.

*In Phase C1, empirical benchmarking using `EXPLAIN (ANALYZE, BUFFERS)` will compare Option 1 (2 partial indexes) vs Option 2 (1 composite index) on representative dataset volume before final deployment.*

### 6.4 Decoupled Maintenance Pruning Routine (Worker Daemon)
Executed every 60 seconds within the background worker using two discrete, indexed statements:
```sql
-- 1. Prune expired unverified challenges (24 hours retention)
DELETE FROM "OTPVerification"
WHERE "verified" = false AND "createdAt" < NOW() - INTERVAL '24 hours';

-- 2. Prune consumed verified challenges (7 days retention)
DELETE FROM "OTPVerification"
WHERE "verified" = true AND "createdAt" < NOW() - INTERVAL '7 days';
```

---

## 7. Topic 6: Redis Queue Durability, Failure Semantics & State Safety

### 7.1 Strict Semantic Integrity on Queue Failure (CRITICAL BLOCKER RESOLVED)
> [!CAUTION]
> **Strict Semantic Invariant:** The database column `verified = true` represents strictly and exclusively that the end-user entered the correct OTP challenge and was successfully authenticated.
> 
> Under **NO circumstances** may an error handler, fallback mechanism, or queue failure update `verified = true`. Updating `verified = true` upon failure corrupts database audit trails, creates false positive authentication records, and incorrectly places dead records into the 7-day verified retention tier instead of the 24-hour unverified tier.

**Exact Queue Dispatch Failure Recovery Protocol:**
If `enqueueSmsDispatch` fails due to Redis unavailability, network timeout, or Redis OOM:
1. `POST /api/waitlist/register` catches the error.
2. The challenge is invalidated strictly by **expiring it immediately**:
   ```sql
   UPDATE "OTPVerification" 
   SET "expiresAt" = NOW() 
   WHERE "id" = :challengeId;
   ```
3. `verified` remains strictly `false`.
4. The challenge becomes instantly un-verifiable in `verify/route.ts` (which checks `expiresAt > NOW()`).
5. Because `verified` remains `false`, this record correctly ages out under the **24-hour unverified retention policy** (and is purged after 24 hours).
6. The route returns **HTTP 503 Service Unavailable** (fail-closed), prompting the user to retry cleanly once Redis recovers.

### 7.2 Durability Boundary & Limitations
- **Durability Reality:** Redis configured with `appendfsync everysec` provides high performance, but it does **not** guarantee absolute "zero message loss." If the Redis host suffers a hard kernel crash or power cut, up to **1 second of unflushed transactions can be lost**.
- **Memory Boundary & OOM:** With `maxmemory-policy noeviction`, critical queue items will never be silently dropped by LRU algorithms. However, if memory reaches `maxmemory 512mb`, Redis will reject write operations (`OOM command not allowed`).
- **Zero Account Data in Redis:** Redis is strictly prohibited from serving as the primary source of truth for accounts, waitlist identity, scores, or payments.

---

## 8. Topic 7: Calculated Connection Budget & Pool Architecture

### 8.1 Server Capacity & Headroom Philosophy
- **PostgreSQL Server `max_connections`:** `100` (Docker default)
- **`superuser_reserved_connections`:** `3`
- **Total Allocatable Connections:** `97`
- **Safety Standard:** Production will **not** be designed to saturate 97 connections. High connection counts in PostgreSQL cause context-switching overhead, memory thrashing, and lock contention.
- **Architecture:** Maintain at least **50%+ operational and failover headroom** under normal operation, allocating a hard ceiling of **$\le 40$ connections** across all application services.

### 8.2 Connection Budget Allocation Matrix

| Service / Component | Process Count | Pool per Process | Total Allocated | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Next.js Web App** | 2 instances (max cluster/container) | **10** | **20** | Handles high-concurrency web requests (status, verify, dashboard) |
| **Background SMS Worker** | 1 instance | **5** | **5** | Dedicated worker processing SMS deadletter & queue |
| **Payment & Maintenance Reaper**| 1 instance (or worker thread) | **3** | **3** | Periodic 60s sweep of expired payment intents & dead OTPs |
| **n8n Orchestrator** | 1 instance | **5** | **5** | Webhook notifications & internal workflow queries |
| **App Pool Buffer** | N/A | N/A | **7** | Spare application connection headroom |
| **APPLICATION POOL CEILING** | — | — | **40 / 100** | Strict 40% application budget limit |
| **Admin & Direct CLI** | Ad-hoc / psql | **5** | **5** | Reserved for psql, migrations, and health diagnostics |
| **Operational & Failover Headroom**| Unused Reserve | — | **52 / 100** | Dedicated headroom for spikes, failovers, and connection churn |
| **TOTAL SERVER CEILING** | — | — | **100** | Absolute PostgreSQL maximum |

*The final per-process pool sizing will be validated and adjusted during Phase D load testing based on connection wait times.*

---

## 9. Topic 8: Performance Claims & Analytical Projections

### Measured vs Projected Performance Matrix

| Metric / Scenario | Measured Baseline (Phase A) | Projected Behavior (Unbenchmarked) | Technical Basis |
| :--- | :--- | :--- | :--- |
| **Waitlist Rank (25 rows)** | **0.659ms** (Planning 3.2ms, Hit 1) | — | Live PostgreSQL `EXPLAIN ANALYZE` |
| **Waitlist Rank (10k rows, no index)** | — | **[ANALYTICAL PROJECTION] ~15–30ms** | Linear scan across ~60 buffer pages |
| **Waitlist Rank (100k rows, no index)** | — | **[ANALYTICAL PROJECTION] ~100–250ms**| Linear scan across ~600 buffer pages |
| **Waitlist Rank (100k rows, B-tree index)** | — | **[ANALYTICAL PROJECTION] ~5–15ms** | Index scan traversing $K$ tuples ($O(K)$) |
| **Waitlist Rank (100k rows, Redis ZSET)** | — | **[ANALYTICAL PROJECTION] <0.2ms** | In-memory skip list lookup ($O(\log N)$) |
| **Active OTP Lookup (51 rows)** | **0.160ms** (Planning 3.6ms, Hit 6) | — | Live PostgreSQL `EXPLAIN ANALYZE` |
| **Active OTP Lookup (100k rows, partial index)** | — | **[ANALYTICAL PROJECTION] <0.5ms** | Direct 1-row partial index seek |

*All projected metrics will be subjected to physical validation during Phase D.*

---

## 10. Topic 9: PII Sanitization & Git History Remediation Roadmap

### 10.1 Discovery
Committed SQL dumps (`backup-before-c1.sql`, `backup-before-c3.sql`) in the repository contain real Iranian phone numbers (`0912...`) and bcrypt hashes.

### 10.2 Safe Remediation Path (Requires Explicit Separate Human Approval)
> [!CAUTION]
> Git history rewriting is a destructive operational action. It must NOT be performed automatically.

1. **Step 1: Secure Off-Site Backup**
   Move the raw backup files to a secure, encrypted local location outside the Git directory.
2. **Step 2: Remove from Current Tree & Gitignore**
   Remove `*.sql` files from the working tree and commit the removal:
   ```bash
   git rm backup-before-c1.sql backup-before-c3.sql
   echo "*.sql" >> .gitignore
   git commit -m "chore(security): remove database dump files from workspace"
   ```
3. **Step 3: History Scrubbing Protocol (Draft for Review)**
   When approved, use `git-filter-repo` to permanently erase the files from all historic Git trees:
   ```bash
   git filter-repo --invert-paths --path backup-before-c1.sql --path backup-before-c3.sql
   ```
4. **Step 4: History Verification**
   Verify zero references remain in Git packfiles:
   ```bash
   git log --all --full-history -- "backup-before-*.sql"
   ```
5. **Step 5: Secret & Credential Rotation**
   Rotate any test credentials, JWT secrets, or DB passwords exposed in the historical dumps.

---

## 11. Topic 10: Phase C Discrete Execution Gates (Stop-and-Approve Governance)

To guarantee zero regressions, zero unreviewed schema mutations, and strict pairing with human review, Phase C implementation is partitioned into **discrete execution gates**.

> [!IMPORTANT]
> **No implicit approval exists between phases.** The agent must halt and request explicit approval at every single checkpoint before proceeding to the next.

```text
  [ Human Approval Gate 2 ]
             │
             ▼
  ┌────────────────────────────────────────────────────────┐
  │ C0: Baseline Migration Setup                           │
  │     - Assign carno_migrator object ownership           │
  │     - Generate baseline migration SQL via diff         │
  │     - Verify 0 drift: diff --from-url (exit code 0)    │
  │     - Audit catalog: unsupported/unmanaged objects = 0 │
  │     - Run `migrate resolve --applied` with             │
  │       MIGRATION_DATABASE_URL credentials               │
  └────────────────────────────────────────────────────────┘
             │
             ▼
       [ STOP GATE C0 ] ──► (Human Review & Verification)
             │
             ▼
  ┌────────────────────────────────────────────────────────┐
  │ C1: Indexes & Constraints Hardening                    │
  │     - Preflight check: 0 duplicate pending/confirmed   │
  │     - Generate SQL via `migrate dev --create-only`     │
  │     - Add/verify custom partial & retention indexes    │
  │     - Apply migration via `migrate deploy`             │
  │     - Benchmark & validate plans via EXPLAIN ANALYZE   │
  └────────────────────────────────────────────────────────┘
             │
             ▼
       [ STOP GATE C1 ] ──► (Human Review & Verification)
             │
             ▼
  ┌────────────────────────────────────────────────────────┐
  │ C2: OTP / User / Referral Concurrency Upgrades         │
  │     - Atomic conditional OTP update (replay defense)   │
  │     - Expire-on-failure queue recovery (no verified=t) │
  │     - Idempotent User/Waitlist creation (P2002 guard)  │
  │     - Referral transaction lock scope tightening       │
  └────────────────────────────────────────────────────────┘
             │
             ▼
       [ STOP GATE C2 ] ──► (Human Review & Verification)
             │
             ▼
  ┌────────────────────────────────────────────────────────┐
  │ C3: Payment Idempotency & Auto-Expiration (Option B)   │
  │     - Implement candidate selection + atomic retry     │
  │     - Implement neutral capacity exhaustion response   │
  │     - Implement Option B webhook transaction guard     │
  │     - Partial unique index on PaymentLog(CONFIRMED)    │
  └────────────────────────────────────────────────────────┘
             │
             ▼
       [ STOP GATE C3 ] ──► (Human Review & Verification)
             │
             ▼
  ┌────────────────────────────────────────────────────────┐
  │ C4: Prisma Pool & Database Roles Hardening             │
  │     - Configure carno_app runtime connection           │
  │     - Update src/lib/prisma.ts process singleton       │
  │     - Bind connection_limit=10 & pool_timeout=10       │
  └────────────────────────────────────────────────────────┘
             │
             ▼
       [ STOP GATE C4 ] ──► (Human Review & Verification)
             │
             ▼
  ┌────────────────────────────────────────────────────────┐
  │ C5: Redis & Worker Maintenance Integration             │
  │     - Add periodic (60s) payment intent expiration loop│
  │     - Add dual-tier OTP retention pruning routine      │
  │     - Add expired session cleanup routine              │
  │     - Configure Redis maxmemory 512mb & AOF persistence│
  └────────────────────────────────────────────────────────┘
             │
             ▼
       [ STOP GATE C5 ] ──► (Human Review & Verification)
             │
             ▼
  ┌────────────────────────────────────────────────────────┐
  │ Phase D: Concurrency & Load Validation Suite           │
  │     - Scenario 1: 200 concurrent status reads          │
  │     - Scenario 2: 50 concurrent OTP verifications      │
  │     - Scenario 3: 50 simultaneous referrals            │
  │     - Scenario 4: 50 concurrent payment intent requests│
  │     - Capture RPS, p50/p95/p99, pool wait, deadlocks   │
  └────────────────────────────────────────────────────────┘
             │
             ▼
  [ Final Production Readiness Sign-off ]
```

### 11.1 Detailed Gate Execution Specifications & Operational Commands

#### Gate C0: Baseline Migration & Role Ownership Bootstrap
- **Credential Segregation:**
  - `DATABASE_URL`: Runtime connection using `carno_app` (DML only, strictly no DDL).
  - `MIGRATION_DATABASE_URL`: Administrative migration connection using `carno_migrator` (Target DB: `carlanding`, full DDL).
  - `SHADOW_DATABASE_URL`: Dedicated shadow migration connection using `carno_migrator` (Shadow DB: `carlanding_shadow`, full DDL).
- **Execution Protocol:**
  1. Superuser executes role creation, shadow database setup, and ownership reassignment script (`prisma/bootstrap-roles.sql`) using `postgres`:
     ```bash
     docker exec -i divarlanding-db-1 psql -U postgres -d carlanding < prisma/bootstrap-roles.sql
     ```
     *Bootstrap script includes: creating `carno_migrator` (NO CREATEDB), creating dedicated shadow database `carlanding_shadow` owned by `carno_migrator`, reassigning all existing objects to `carno_migrator`, creating `carno_app`, and revoking `CREATE` on schema `public` from BOTH `PUBLIC` and `carno_app`.*
  2. Confirm 100% of tables, sequences, and enums in `public` have `carno_migrator` ownership:
     ```bash
     docker exec -i divarlanding-db-1 psql -U postgres -d carlanding -c "SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public';"
     ```
  3. Generate baseline migration from empty schema to match existing data model, executed strictly with `MIGRATION_DATABASE_URL`:
     ```bash
     DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate diff \
       --from-empty \
       --to-schema-datamodel prisma/schema.prisma \
       --script > prisma/migrations/0_baseline/migration.sql
     ```
  4. Verify zero schema drift between live database and Prisma schema:
     ```bash
     DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate diff \
       --from-url "$MIGRATION_DATABASE_URL" \
       --to-schema-datamodel prisma/schema.prisma \
       --exit-code
     ```
     **Exit Code Interpretation Standard:**
     - `0`: Success — Zero schema drift detected (live PostgreSQL exactly matches `prisma/schema.prisma`).
     - `2`: Schema drift exists (live database objects differ from Prisma schema datamodel; migration must abort).
     - `1`: Error executing command or network/authentication failure.

  5. Audit PostgreSQL Catalog for Non-Prisma / Unmanaged Objects:
     Prisma `migrate diff` exclusively analyzes objects supported by Prisma ORM. Prior to marking baseline as applied, execute an exhaustive catalog inventory to detect any unmanaged PostgreSQL objects:
     ```sql
     SELECT 'table' AS obj_type, tablename AS obj_name FROM pg_tables WHERE schemaname = 'public'
     UNION ALL
     SELECT 'sequence' AS obj_type, sequence_name AS obj_name FROM information_schema.sequences WHERE sequence_schema = 'public'
     UNION ALL
     SELECT 'enum' AS obj_type, typname AS obj_name FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e'
     UNION ALL
     SELECT 'view' AS obj_type, table_name AS obj_name FROM information_schema.views WHERE table_schema = 'public'
     UNION ALL
     SELECT 'matview' AS obj_type, matviewname AS obj_name FROM pg_matviews WHERE schemaname = 'public'
     UNION ALL
     SELECT 'function' AS obj_type, proname AS obj_name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
     UNION ALL
     SELECT 'trigger' AS obj_type, trigger_name AS obj_name FROM information_schema.triggers WHERE trigger_schema = 'public'
     UNION ALL
     SELECT 'extension' AS obj_type, extname AS obj_name FROM pg_extension WHERE extnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
     ```
     **Assertion Requirement:**
     - Cross-reference with Prisma models (`User`, `WaitlistEntry`, `OTPVerification`, `PaymentIntent`, `PaymentLog`, `Session`, `AdminUser`, `Referral`) and enums (`UserStatus`, `PaymentStatus`, `ReferralStatus`).
     - Confirm: `Unsupported / unmanaged objects = 0` (or explicitly documented as 'managed separately').

  6. Resolve baseline migration as applied using `MIGRATION_DATABASE_URL`:
     ```bash
     DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --applied 0_baseline
     ```

  7. Migration Ledger Lockdown (`_prisma_migrations` Isolation):
     Because `ALTER DEFAULT PRIVILEGES` grants DML to `carno_app` on newly created tables in public schema, immediately revoke all privileges on `_prisma_migrations` from `carno_app`:
     ```sql
     REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM carno_app;
     ```
     Execute and verify privilege assertion:
     ```sql
     SELECT 
       has_table_privilege('carno_app', '_prisma_migrations', 'SELECT') AS can_select,
       has_table_privilege('carno_app', '_prisma_migrations', 'INSERT') AS can_insert,
       has_table_privilege('carno_app', '_prisma_migrations', 'UPDATE') AS can_update,
       has_table_privilege('carno_app', '_prisma_migrations', 'DELETE') AS can_delete;
     ```
     **Assertion Requirement:** All four columns MUST return `false` (`f`). `carno_migrator` retains 100% ownership and full DDL/DML access.

  8. **STOP GATE C0:** Provide full terminal output, git diff, and database inspection results for human verification.

#### Gate C1: Indexes & Constraints Hardening
- **Mandatory Preflight Integrity Checks (Live Database Data Guard):**
  Before attempting to create unique indexes and constraints, run live checks to guarantee zero duplicate or invalid records exist that would cause index/constraint creation to fail:
  ```sql
  -- Preflight 1: Verify zero duplicate active pending codes
  SELECT "uniqueCode", COUNT(*) 
  FROM "PaymentIntent" 
  WHERE "status" = 'PENDING' 
  GROUP BY "uniqueCode" 
  HAVING COUNT(*) > 1;

  -- Preflight 2: Verify zero duplicate confirmed payments
  SELECT "paymentId", COUNT(*) 
  FROM "PaymentLog" 
  WHERE "action" = 'CONFIRMED' 
  GROUP BY "paymentId" 
  HAVING COUNT(*) > 1;

  -- Preflight 3: Verify all existing PaymentIntents comply with code bounds (1–999) and amount formula
  SELECT id, "uniqueCode", "totalAmount"
  FROM "PaymentIntent"
  WHERE "uniqueCode" < 1 OR "uniqueCode" > 999 OR "totalAmount" != 299000 + "uniqueCode";
  ```
  **STOP CRITERION:** All three preflight checks MUST return **0 rows**. If any rows are returned, the migration MUST halt immediately for human review and anomaly remediation before proceeding.

- **Prisma Schema Updates (`prisma/schema.prisma`):**
  1. **Configure Shadow Database URL in Datasource:**
     ```prisma
     datasource db {
       provider          = "postgresql"
       url               = env("DATABASE_URL")
       shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
     }
     ```
  2. **Remove Obsolete Composite Constraint:**
     **Delete `@@unique([uniqueCode, status])` from `model PaymentIntent`.**  
     *(Prisma schema must NOT declare this obsolete composite constraint, preventing future migrations from attempting to re-create it).*
  3. **Add Dedicated Expiration Timestamp:**
     Add `expiredAt DateTime?` to `model PaymentIntent`.
  4. **Add Composite Index on Waitlist:**
     Add `@@index([priorityScore(sort: Desc), joinedAt(sort: Asc)])` to `model WaitlistEntry`.
  5. **Add Foreign Key & Session Abuse Indexes:**
     `PaymentIntent(userId)`, `PaymentLog(paymentId, createdAt DESC)`, `Session(userId, createdAt DESC)`.

- **Migration SQL Raw Declarations (`migration.sql`):**
  1. Drop obsolete composite index and add PostgreSQL partial unique index:
     ```sql
     DROP INDEX IF EXISTS "PaymentIntent_uniqueCode_status_key";
     CREATE UNIQUE INDEX "PaymentIntent_uniqueCode_pending_key" 
     ON "PaymentIntent" ("uniqueCode") 
     WHERE status = 'PENDING';
     ```
  2. Add database-level CHECK constraints for total amount binding and code bounds:
     ```sql
     ALTER TABLE "PaymentIntent" 
       ADD CONSTRAINT "check_payment_intent_unique_code_range" 
       CHECK ("uniqueCode" >= 1 AND "uniqueCode" <= 999);

     ALTER TABLE "PaymentIntent" 
       ADD CONSTRAINT "check_payment_intent_total_amount_calc" 
       CHECK ("totalAmount" = 299000 + "uniqueCode");
     ```
  3. Add hot point-lookup index for OTP authentication:
     ```sql
     CREATE INDEX "OTPVerification_phone_active_idx" 
     ON "OTPVerification" ("phone", "createdAt" DESC) 
     WHERE verified = false;
     ```
  4. Add dedicated maintenance retention indexes for OTP cleanup (evaluated via `EXPLAIN (ANALYZE, BUFFERS)`):
     ```sql
     CREATE INDEX "OTPVerification_retention_unverified_idx" ON "OTPVerification" ("createdAt") WHERE verified = false;
     CREATE INDEX "OTPVerification_retention_verified_idx" ON "OTPVerification" ("createdAt") WHERE verified = true;
     ```
  5. Add confirmation log storage guard:
     ```sql
     CREATE UNIQUE INDEX "PaymentLog_paymentId_confirmed_key" ON "PaymentLog" ("paymentId") WHERE action = 'CONFIRMED';
     ```

- **Production-Grade Execution Protocol (`--create-only` + `deploy`):**
  To prevent unwanted schema mutations, interactive development reset prompts, or uncontrolled DDL execution:
  1. Generate migration without applying, using `MIGRATION_DATABASE_URL` and `SHADOW_DATABASE_URL`:
     ```bash
     DATABASE_URL="$MIGRATION_DATABASE_URL" SHADOW_DATABASE_URL="$SHADOW_DATABASE_URL" npx prisma migrate dev --create-only --name c1_indexes_and_constraints
     ```
     *(Because `SHADOW_DATABASE_URL` points to pre-provisioned `carlanding_shadow` owned by `carno_migrator`, Prisma never requires `CREATEDB`).*
  2. Inspect the generated file: `prisma/migrations/*_c1_indexes_and_constraints/migration.sql`.
  3. Append custom PostgreSQL partial indexes, CHECK constraints, and retention indexes into `migration.sql`.
  4. Perform thorough code/SQL review of the final migration script.
  5. Apply the migration deterministically via `migrate deploy`:
     ```bash
     DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy
     ```
  6. Empirical Benchmarking & Validation:
     - Run `EXPLAIN (ANALYZE, BUFFERS)` on OTP cleanup query (benchmarking 2 partial indexes vs 1 composite index).
     - Run `EXPLAIN (ANALYZE, BUFFERS)` on waitlist rank query to inspect plan choice and buffer hits.
  7. **STOP GATE C1:** Provide execution plan verification and schema diff for human review.

#### Gate C2: OTP / User / Referral Concurrency Upgrades
- **Application Code Hardening:**
  - Atomic OTP replay defense in `src/app/api/waitlist/verify/route.ts`:
    `UPDATE "OTPVerification" SET verified = true WHERE id = :id AND verified = false`.
  - Redis queue failure handling in `src/app/api/waitlist/register/route.ts`:
    Catch error, expire challenge immediately via `UPDATE "OTPVerification" SET "expiresAt" = NOW() WHERE "id" = :id` keeping `verified = false`. Under NO circumstances set `verified = true`. Return HTTP 503.
  - Idempotent User & Waitlist creation handling PostgreSQL `P2002` concurrency collisions gracefully.
  - Referral score transaction tightening.
- **Verification:** Unit tests & typescript build verification (`npx tsc --noEmit`).
- **STOP GATE C2:** Present code diff for human review.

#### Gate C3: Payment Idempotency & Auto-Expiration (Approved Option B)
- **Application Code Implementation:**
  - Payment code pool allocator (1–999) using active sweep + candidate selection + atomic retry on `P2002`.
  - Sustainable candidate selection SQL excluding:
    1. Active `PENDING` intents (`status = 'PENDING' AND expiresAt > NOW()`).
    2. Expired intents under 30-minute quarantine cooldown (`status = 'EXPIRED' AND COALESCE(expiredAt, expiresAt) > NOW() - INTERVAL '30 minutes'`).
    3. Paid intents under 24-hour post-paid quarantine cooldown (`status = 'PAID' AND confirmedAt > NOW() - INTERVAL '24 hours'`).
  - Graceful capacity exhaustion response: `"ظرفیت درخواست‌های فعال پرداخت موقتاً تکمیل است. لطفاً کمی بعد دوباره تلاش کنید."`
  - Approved Option B Webhook Handler:
    - Provider `referenceId` treated strictly as metadata.
    - Deterministic resolution of single active `PENDING` intent via `totalAmount = 299000 + uniqueCode` **WITHOUT `LIMIT 1`**.
    - Explicit 3-way invariant branches:
      - `0 rows` $\to$ Check historical status, return HTTP 200 `{ status: "IGNORED", reason: "ALREADY_PROCESSED_OR_EXPIRED" }`.
      - `1 row` $\to$ Proceed with atomic transaction.
      - `> 1 rows` $\to$ Critical data anomaly alert, abort transaction, return HTTP 500 fail-closed.
    - Decoupled error handling: Database timeouts, network errors, and unexpected exceptions return HTTP 500/503 (retryable), NEVER HTTP 200.
    - Atomic conditional status update `UPDATE "PaymentIntent" SET status = 'PAID', confirmedAt = NOW(), updatedAt = NOW() WHERE id = :id AND status = 'PENDING'`.
    - Single confirmation log insertion guarded by unique index.
    - User account promotion to `EARLY_ACCESS`.
- **Verification:** Mock webhook idempotency test script.
- **STOP GATE C3:** Present code diff and mock test outputs for human review.

#### Gate C4: Prisma Connection Pool & Database Roles Hardening
- **Configuration Updates:**
  - Transition application `.env` to `DATABASE_URL="postgresql://carno_app:..."` with `connection_limit=10&pool_timeout=10&connect_timeout=5`.
  - Update `src/lib/prisma.ts` singleton to enforce connection pool configuration.
  - Verify that runtime application user `carno_app` can perform all required DML operations but cannot execute DDL statements (permission denied on `CREATE TABLE`).
  - **Mandatory DDL Security Privilege Assertion Check:**
    Execute and verify:
    ```sql
    SELECT has_schema_privilege('carno_app', 'public', 'CREATE');
    ```
    **Assertion:** Must return strictly `f` (false).
- **STOP GATE C4:** Present security verification output and assertion check for human review.

#### Gate C5: Redis & Worker Maintenance Integration
- **Background Worker Implementation:**
  - Integrate periodic 60-second reaper routines:
    1. Stale pending payment intents auto-expiration (setting `status = 'EXPIRED'`, `expiredAt = NOW()`).
    2. Dual-tier OTP retention pruning (24h unverified, 7d verified).
    3. Expired sessions pruning.
  - Redis 7 durability and memory configuration: `maxmemory 512mb`, `maxmemory-policy noeviction`, `appendfsync everysec`.
- **STOP GATE C5:** Present worker routine code diff and log outputs for human review.

#### Phase D: Concurrency & Load Validation Suite
- **Automated Stress Testing Scenarios:**
  - Scenario 1: 200 concurrent status/rank reads.
  - Scenario 2: 50 concurrent OTP verifications on competing codes.
  - Scenario 3: 50 simultaneous referrals targeting same parent user.
  - Scenario 4: 50 concurrent payment intent creations under code pool contention.
- **Metrics Collected:** Real RPS, p50/p95/p99 latency, connection pool wait times, zero deadlocks, zero duplicate records.
- **FINAL PRODUCTION READINESS SIGN-OFF.**

---

## 12. Non-Negotiable Protected Core Status

```text
src/features/carno-experience/engine/**  --> 0 changes
public/car-frames/**                    --> 0 changes
```

---

## 13. Plan Status & Final Gate Notice

Phase B Plan Revision (v6) is **COMPLETE**.  
All human review directives (Blockers 1, 2, 3 and Hardenings 4, 5, 6, 7, 8) have been incorporated with zero changes to schema, migrations, code, or databases.

**STOPPED. Awaiting explicit human approval on Gate 2 to proceed to Phase C0 (Baseline Migration).**
