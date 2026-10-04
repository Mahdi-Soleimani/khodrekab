# Carno — Backend Security Hardening Specification (Phase B, Revised)
## Iran-First Architecture, Threat Mitigation & Implementation Specification

> **Project:** Carno / کارنو  
> **Repository:** `radifo-khodro-landing`  
> **Base Branch:** `conversion-redesign` (Clean commit: `aeb5da2`)  
> **Active Work Branch:** `security-hardening`  
> **Status:** Phase B Revised (Gate 2 Approved with Corrections) — Specification Only (Zero Code, Zero DB Changes)  
> **Document Purpose:** Complete technical specification and implementation blueprint for security hardening of Carno across OTP, SMS, waitlist, referral, session, payment, PII, headers, and observability under strict Iran-First constraints.

---

## 1. Global Architectural Principles & Iran-First Constraints

### 1.1 Strict Iran-First Operating Environment
Every control specified in this document is engineered to operate reliably within the Iranian telecommunications and network ecosystem without depending on foreign CDNs, cloud services, or external APIs subject to filtering or sanctions:

1. **Zero Foreign Cloud Dependencies:** All runtime dependencies on Google (Analytics, Fonts, reCAPTCHA), Cloudflare Turnstile, hCaptcha, Telegram Bot API, Sentry Cloud, PostHog Cloud, and Microsoft Clarity are strictly prohibited in production runtime.
2. **Self-Hosted First:** Assets (fonts, scripts, icons), Proof-of-Work bot challenges, monitoring, and analytics must run on infrastructure hosted inside Iran or self-contained in the deployment bundle.
3. **Iranian Domestic Rails:** SMS gateways (MeliPayamak primary, with domestic failover) and payment channels (Shaparak, card-to-card) must use domestic Iranian endpoints.
4. **Mobile UX Reality (CGNAT):** CGNAT network sharing is standard across Iranian mobile operators (Irancell, MCI, Rightel). Strict single-IP thresholds drop legitimate users; rate limits must fuse IP, anonymous device cookies, and phone numbers.
5. **Fail-Closed Security:** If security dependencies (Redis, token validators, pepper keys) are unreachable in production, requests are rejected safely with respectful Persian error messages.
6. **No Real Third-Party Tests:** All automated tests must run locally with mocks; no real SMS or real payments are ever executed during testing.

---

## 2. Gate 2 Approved Decisions & Audit Corrections

### 2.1 Owner Decisions (Recorded as Approved)
The following architectural choices have been formally decided and approved by the project owner:

- **[D-A] Bot Challenge (APPROVED):** In-house Proof-of-Work using Node `crypto` standard library (zero external dependencies). *Altcha is NOT approved.*
- **[D-B] Input Validation (APPROVED):** In-house native TypeScript validation schemas using standard JavaScript types, regex, and bounds checking. *Zod is NOT approved.*
- **[D-C] Redis Client (APPROVED):** `ioredis` is approved as the single new production dependency for Phase C1 to execute atomic sliding-window Lua scripts.
- **[D-D] Referral Policy (APPROVED):** Daily soft threshold of 20 successful invites per 24 hours, 24-hour maturity delay, and cluster flagging. Existing points (+50 / +200) remain strictly unchanged.
- **[D-E] Payment Flow (APPROVED):** `/api/payment/*` is disabled by default in production (`ENABLE_PAYMENT_FLOW=false`) until the legal refund/cancellation terms are finalized.
- **[D-F] Session Lifetime (APPROVED):** Access token lifetime set to 2 hours, paired with a revocable server-side session tracking table (Phase C3).
- **[D-G] SMS Thresholds (PROPOSED):** Proposed baseline ceilings (global: 60/hr, 300/day; IP: ~20/hr; phone: 3/hr, 10/day; progressive cooldown: 60s, 120s, 300s) remain proposed until final confirmation.

### 2.2 Revisions & Corrections Applied (R1 – R9)

| Revision | Finding / Gap in Initial Spec | Corrected Specification & Action | Status |
| :--- | :--- | :--- | :--- |
| **R1** | `__Host-` cookie fails on `http://localhost` during development | Production uses `__Host-carno_session` with `Secure: true`. Development uses `carno_session` with `Secure: false`. Name and option selection is centralized in a single helper (`getSessionCookieConfig()`). Tests cover both environments. | **SPECIFIED (B.3)** |
| **R2** | Timing equalization (fixed 250ms) does not hide slow SMS gateway round-trips | Compared Design (a) Asynchronous Queue Dispatch vs Design (b) Fixed Worst-Case Delay Window. **Recommended Design (a):** Return uniform response immediately after database challenge creation and dispatch SMS asynchronously; response time is decoupled from SMS network latency. | **SPECIFIED (B.4)** |
| **R3** | Labeling `script-src 'unsafe-inline'` as "strict" was inaccurate | Relabeled as an **EXPLICIT COMPROMISE** required by Next.js bootstrap scripts and CSS injection. Added future-improvement item for middleware nonce-based CSP. Specified production build verification test to prove `'unsafe-eval'` is unnecessary. | **SPECIFIED (B.9)** |
| **R4** | Alerting via the same OTP line causes budget blocking and pattern restrictions | Specified a **SEPARATE reserved alert budget** (not consumed by OTP), requiring a separately approved alert pattern, and configured domestic SMTP email as an equal first-class alert channel. | **SPECIFIED (B.10)** |
| **R5** | Hard cap of 5 referrals/day kills organic viral growth | Replaced with a **daily soft threshold of 20**; suspicious clusters (same IP/device in a short window) are flagged for review rather than hard-dropped. Point values (+50 / +200) are unchanged. | **SPECIFIED (B.6)** |
| **R6** | Redis client & development fallback | Confirmed `ioredis` with native Lua script support. Specified an in-memory sliding-window fallback ONLY for local development (`NODE_ENV !== 'production'`). Production without Redis strictly fails closed. | **SPECIFIED (B.1)** |
| **R7** | Incomplete PII lifecycle | Explicitly stated that until the plaintext `phone` column is dropped and old database dumps/backups containing plaintext are purged, PII privacy goals are **NOT MET**. Scheduled drop as an explicit post-cutover human-gated task. | **SPECIFIED (B.8)** |
| **R8** | Filtered Telegram support link in UI | `t.me/jeyhub_support` is filtered in Iran. Specified UI change to prioritize domestic contacts (Bale/Eitaa/Phone/Email) as primary, with Telegram secondary. (Requires explicit human copy approval before implementation; not part of C1). | **SPECIFIED (Section 4)** |
| **R9** | Unverified legal & identity assumptions | Unconfirmed domains (`carno.ir`) and contact emails (`privacy@carno.ir`, `security@carno.ir`) are marked `PENDING OWNER CONFIRMATION`. Regulatory statements are marked `PENDING LEGAL REVIEW`. | **SPECIFIED (Section 6 & 7)** |

### 2.3 Amendments A1 – A6

| Amendment | Change | Sections Touched | Status |
| :--- | :--- | :--- | :--- |
| **A1** | OTP failed-attempt counters must survive Redis loss: production Redis AOF + `noeviction`; `/api/waitlist/verify` is fail-closed on counter read AND write failure; optional PostgreSQL backstop keyed by phone hash; new tests. | B.2, B.1 (fail-closed note), B.12, Section 5 (Infra) | AOF + verify fail-closed: `CONFIRMED` (amendment instruction). Postgres backstop: `PROPOSED — NEEDS APPROVAL`. |
| **A2** | Device cookie reworded: it is a CGNAT disambiguation aid only, NOT a security boundary. Never the sole key for any limit. Residual distributed-attack risk and its detecting alert documented. | B.1, B.12 | `CONFIRMED` |
| **A3** | Trusted IP header honored only when the socket peer is inside `TRUSTED_PROXY_CIDRS`; header ignored (with startup warning) if CIDRs empty in production; right-most untrusted hop for `X-Forwarded-For`. CIDR list is PENDING (P1). Firewall origin to edge ranges. | B.1, B.12, Section 5, Section 7 | Mechanism: `CONFIRMED`. CIDR values: `PENDING — depends on P1`. |
| **A4** | C1 uses MeliPayamak only. No secondary provider code/SDK/credentials in C1. Future failover must pass through the same limiter, budget and kill switch. Explicit C1 out-of-scope list. | B.1, B.13 | `CONFIRMED` |
| **A5** | "Timing Equalization" test renamed to "Structural Response-Equivalence Test"; defined exactly; disclaimer that it is a regression guard, not proof of timing side-channel resistance. "Indistinguishable" wording removed. | B.4, B.12 | `CONFIRMED` |
| **A6** | New decision record for hard-coded Sample Analysis card values with a pre-public-launch gate (3 options). No code change. | Section 4.1 (new), Section 7 | `PENDING OWNER DECISION` |

### 2.4 Status-Label Integrity Corrections (found during A1–A6 review)

The previous revision upgraded three items to `CONFIRMED` without owner approval. Corrected to the stricter label:

| Item | Previous Label | Corrected Label | Reason |
| :--- | :--- | :--- | :--- |
| B.2 HMAC storage, pepper, 5-digit retention | `CONFIRMED (D-5)` | `PROPOSED — NEEDS APPROVAL (D5)` | D5 was listed under "PROPOSED — NEEDS APPROVAL" in the Phase B instruction and was not in the Gate 2 approved list (D-A … D-F). |
| B.4 Selected timing design (async dispatch) | `CONFIRMED` | `PROPOSED — NEEDS APPROVAL (R2 recommendation)` | R2 asked for a recommendation, not a decision. IDOR rules and the referral-link env fix remain `CONFIRMED`. |
| B.5 Code-pool expansion to 1000–9999 | covered by `CONFIRMED (D-E)` | `PROPOSED — NEEDS APPROVAL` | D-E approves only "payment disabled by default". The amount-range change affects the price the user transfers and is a business decision. |

---

## 3. Specifications for Security Controls (B.1 – B.13)

---

### B.1 SMS Abuse & Pumping Protection (Highest Priority)

#### 1. Technical Design
A multi-tier sliding-window rate limiter backed by Redis using atomic Lua scripts to prevent race conditions. Because Iranian mobile operators heavily utilize CGNAT (many handsets sharing a single gateway IP), the limiter uses the following keys:
1. `phone_hash`: HMAC-SHA256 of the normalized Iranian phone number. **Security boundary.**
2. `ip_hash`: Client IP (resolved per A3) hashed with a rotating daily salt. **Security boundary** (CGNAT-tolerant threshold).
3. Global hourly/daily counters. **Security boundary.**
4. `device_id`: Signed anonymous cookie (`__carno_did`). **NOT a security boundary** — see A2 below.

Security boundaries for SMS sending are exactly: per-phone limits, per-IP limits, global limits, the PoW challenge, and the budget caps / kill switch. The device cookie is never the sole key for any limit.

```text
Incoming POST /api/waitlist/register
       │
       ├── 1. Check Global Kill Switch (SMS_KILL_SWITCH == 'true') ──► [FAIL CLOSED: 503]
       ├── 2. Validate Honeypot & Minimum Fill Time (> 1.5s) ────────► [REJECT BOT: 400]
       ├── 3. Verify In-House PoW Challenge (crypto standard lib) ───► [REJECT INVALID: 400]
       ├── 4. Redis Multi-Key Atomic Check (Lua via ioredis):
       │       ├── Check Global Daily Cap (current_day_count < 300) ──► [EXCEEDED: 429]
       │       ├── Check Global Hourly Cap (current_hour_count < 60) ─► [EXCEEDED: 429]
       │       ├── Check Phone Tier:
       │       │     ├── Cooldown Ladder (60s -> 120s -> 300s) ──────► [COOLDOWN: 429]
       │       │     └── Max 3/hr, 10/day ────────────────────────────► [EXCEEDED: 429]
       │       └── Check CGNAT IP Tier: Max 20/hr per IP ─────────────► [EXCEEDED: 429]
       │
       ▼ Passed All Checks
Create Challenge Record ──► Enqueue / Dispatch SMS (MeliPayamak only in C1 — see A4)
```

- **Decision Status:**
  - In-house PoW Challenge: `CONFIRMED (D-A)`
  - Redis Client (`ioredis`): `CONFIRMED (D-C)`
  - SMS Thresholds: `PROPOSED — NEEDS APPROVAL (D-G)`
- **Iran-compatibility:** 100% self-hosted on local/domestic Redis; Proof-of-Work runs locally in the client browser without outbound requests; external dependencies: **none**.
- **Data Model Changes:** None (state stored in Redis keys: `sms:global:day:YYYYMMDD`, `sms:global:hour:YYYYMMDDHH`, `sms:phone:<hash>:cooldown`, `sms:ip:<hash>:hour`).
- **Environment Variables (Names Only):**
  - `SMS_KILL_SWITCH` (boolean: `true` / `false`)
  - `SMS_GLOBAL_HOURLY_CAP` (default: `60`)
  - `SMS_GLOBAL_DAILY_CAP` (default: `300`)
  - `SMS_IP_HOURLY_CAP` (default: `20`)
  - `SMS_PHONE_HOURLY_CAP` (default: `3`)
  - `SMS_PHONE_DAILY_CAP` (default: `10`)
  - `TRUSTED_IP_HEADER` (header name; empty = use socket address) — see A3
  - `TRUSTED_PROXY_CIDRS` (comma-separated CIDRs of the real edge/proxy; values `PENDING — depends on P1`) — see A3
  - `POW_SECRET_PEPPER` (32-character hex secret for signing PoW tokens)
- **Fail-Closed Behavior & Development Fallback (Revision R6):**
  - **Production:** If Redis is unreachable or times out (> 250ms), the request is **REJECTED (503)** immediately. No SMS is dispatched.
  - **Development Only:** When `NODE_ENV !== 'production'`, an in-memory sliding-window fallback is enabled to permit local offline development. This fallback is hard-disabled if `NODE_ENV === 'production'`.
- **User-Facing Persian Messages:**
  - Cooldown: `«کد تایید به تازگی ارسال شده است. لطفاً {seconds} ثانیه دیگر دوباره امتحان کنید.»`
  - Daily/Hourly limit: `«تعداد درخواست‌های پیامک برای این شماره بیش از حد مجاز است. لطفاً ساعاتی دیگر تلاش کنید.»`
  - Bot verification failure: `«اعتبارسنجی امنیتی با خطا مواجه شد. لطفاً صفحه را بازنگری (Refresh) کنید.»`
  - Kill-switch / Service unavailable: `«سرویس ارسال پیامک موقتاً جهت بهینه‌سازی در دسترس نیست. لطفاً دقایقی دیگر مراجعه فرمایید.»`
  - Network delay hint: `«ارسال کد ممکن است تا ۲ دقیقه طول بکشد.»`
- **Tests:**
  1. Single IP burst of 50 requests: verifies cutoff at 20.
  2. CGNAT simulation: many device cookies from one IP — legitimate users under the IP cap are not blocked by each other's phone limits.
  3. Cooldown ladder progression: 60s -> 120s -> 300s.
  4. Redis timeout simulation (>250ms): verifies 503 response and mock SMS transport is never called.
  5. Kill-switch toggle: verifies immediate 503.
  6. Device-cookie rotation (A2): attacker sends a fresh cookie on every request — still cut off by per-phone, per-IP and global caps.
  7. Spoofed trusted header from an untrusted peer (A3): header ignored, socket address used for the IP limit.

#### 2. Device Cookie Is Not a Security Boundary (Amendment A2)
- The signed anonymous device cookie (`__carno_did`) is ONLY an aid to distinguish many real users behind one CGNAT IP (e.g. for analytics of limiter behavior and for referral cluster flagging in C3).
- It is NOT an authentication or abuse boundary: an attacker can discard it and request a new one on every call.
- No limit is keyed solely on the device cookie. Every SMS-sending decision is bounded by per-phone, per-IP and global caps, the PoW challenge, and the kill switch.
- **Consequence:** an attacker rotating device cookies gains nothing beyond what per-phone, per-IP and global caps already allow.
- **Residual risk:** a distributed attack across many IPs AND many phone numbers is bounded only by the global hourly/daily caps, PoW cost, and the kill switch. Worst case per day = `SMS_GLOBAL_DAILY_CAP` messages of spend, after which legitimate users are also blocked until reset (availability impact).
- **Detection:** alert when global SMS consumption crosses 80% / 100% of the daily cap, and when the ratio of sent OTPs to successful verifications drops below a threshold (proposed: < 20% verified over 1 hour, `PROPOSED — NEEDS APPROVAL`). Real alert delivery is PENDING (P6); in C1 the alert hook is a stub interface.

#### 3. Trusted Client-IP Resolution (Amendment A3)
- Settings (names only): `TRUSTED_IP_HEADER`, `TRUSTED_PROXY_CIDRS`.
- **Rule:** the header value is honored ONLY if the direct socket peer address is inside `TRUSTED_PROXY_CIDRS`. Otherwise the header is ignored and the socket address is used.
- If `TRUSTED_IP_HEADER` is set but `TRUSTED_PROXY_CIDRS` is empty in production, the header is ignored and a startup warning is logged. It is never trusted blindly.
- **`X-Forwarded-For`:** walk the list from the RIGHT, skipping addresses inside `TRUSTED_PROXY_CIDRS`; the first address that is not a trusted proxy is the client IP. The left-most value is never used (it is client-controlled).
- **Provider ranges:** the Iranian edge provider's CIDR list is `PENDING — depends on P1 hosting/edge provider`. No provider IP ranges are invented or hard-coded.
- Until P1 is answered, production behavior = socket address only (the strictest safe default). Behind an edge proxy this makes all users appear as the proxy IP; this is why the per-IP limit must not be the only boundary, and why P1 blocks production rollout of the per-IP tier.
- Iran-compatibility: pure configuration + Node `net` address parsing; external dependencies: none.

#### 4. SMS Provider Scope (Amendment A4)
- C1 uses **MeliPayamak only**. No secondary provider code, SDK, dependency, or credentials is added in C1.
- The existing internal `SmsProvider` interface in `src/lib/sms/types.ts` is kept as the boundary. No second implementation is added.
- **Future rule (post-C1):** any failover provider must be invoked from behind the SAME rate limiter, budget counters and kill switch. Failover must never create a second, uncounted sending path. A failed primary send that falls over to secondary counts once against all caps.
- Secondary provider selection: `PENDING (P5)`, scheduled after C1.

---

### B.2 OTP Lifecycle & Storage Hardening

#### 1. Technical Design
Eliminates weak 5-digit bcrypt hashing vulnerability. Bcrypt over 90,000 values is vulnerable to rainbow table/GPU reversal if the database is leaked.

1. **Storage Algorithm:** Store OTP digest as:
   $$\text{codeHash} = \text{HMAC-SHA256}(\text{OTP\_PEPPER}, \text{phone} \mathbin{\Vert} \text{challengeId} \mathbin{\Vert} \text{code})$$
   where `OTP_PEPPER` exists only in server environment memory.
2. **Timing-Safe Comparison:** Verification uses `crypto.timingSafeEqual(Buffer.from(providedDigest), Buffer.from(storedDigest))` on buffers of verified equal length.
3. **Cross-Challenge Lockout:**
   - Failed attempts are tracked in Redis per phone: `otp:fail:<phone_hash>`.
   - Re-requesting an OTP does **NOT** reset this counter.
   - If 10 failed attempts occur within 1 hour across all challenges for a phone, the phone is locked out from verification for 30 minutes.

#### 2. Counter Durability & Verify Fail-Closed (Amendment A1)
**(a) Production Redis persistence (CONFIRMED):**
- Production Redis MUST run with AOF persistence (`appendonly yes`, `appendfsync everysec` or stricter).
- `maxmemory-policy noeviction` for the instance holding security counters, so eviction can never silently drop lockout keys.
- AOF **reduces but does not eliminate** loss (up to ~1s of writes with `everysec`, plus operator flushes or volume loss). Therefore (b) is mandatory and (c) is recommended.

**(b) VERIFY is fail-closed, not only SEND (CONFIRMED):**
- If the lockout/attempt counter store is unreachable, times out (>250ms), or the counter state for the phone cannot be read, `/api/waitlist/verify` rejects with **HTTP 503**. The OTP code is NOT evaluated.
- If a wrong code is detected but the failed-attempt increment cannot be written, the response is **HTTP 503**, not a normal "wrong code" response. The attacker does not receive a free, uncounted guess. The per-challenge `attempts` column in PostgreSQL is still incremented in the same request where possible.
- Order of operations: read counters → check lock → evaluate code → on failure write increment(s) → only then return "wrong code".

**(c) Durable PostgreSQL backstop (PROPOSED — NEEDS APPROVAL):**
- Mirror the per-phone failed-attempt count into PostgreSQL on every failed verify, keyed by HMAC phone hash only (no raw phone).
- Effective count = `MAX(redis_count, postgres_count)` within the current window. After a Redis flush, the PostgreSQL value still enforces the lockout.
- If the PostgreSQL write fails, the same 503 rule as (b) applies.
- Additive schema (shown only; NOT migrated):
  ```prisma
  model OtpFailureCounter {
    phoneHash    String   @id            // HMAC-SHA256(OTP_PEPPER-derived key, normalizedPhone)
    windowStart  DateTime
    failCount    Int      @default(0)
    lockedUntil  DateTime?
    updatedAt    DateTime @updatedAt
  }
  ```
  ```sql
  -- forward (additive)
  CREATE TABLE "OtpFailureCounter" (
    "phoneHash"   TEXT PRIMARY KEY,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "failCount"   INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt"   TIMESTAMP(3) NOT NULL
  );
  -- rollback (drops only this new table; requires explicit approval like any DROP)
  DROP TABLE "OtpFailureCounter";
  ```
- Rollback impact: removing the table removes only the backstop; Redis counters and per-challenge attempts remain.
4. **Code Length Decision:** Keep 5 digits (`10000`–`99999`) to match the approved MeliPayamak pattern template. (Moving to 6 digits requires re-submitting pattern to telecom regulator, which introduces administrative launch delays).
5. **Backward Compatibility:** Challenges created immediately prior to deployment (bcrypt hashes) will continue to verify until their 5-minute expiry, after which only HMAC challenges are accepted.

- **Decision Status:**
  - HMAC Storage & Pepper: `PROPOSED — NEEDS APPROVAL (D5)` *(corrected, see 2.4)*
  - 5-Digit Length Preservation: `PROPOSED — NEEDS APPROVAL (D5)` *(corrected, see 2.4)*
  - Lockout Thresholds (10 attempts / 30 mins): `PROPOSED — NEEDS APPROVAL (D-G)`
  - Redis AOF + `noeviction` + verify fail-closed (A1 a, b): `CONFIRMED`
  - PostgreSQL backstop (A1 c): `PROPOSED — NEEDS APPROVAL`
- **Iran-compatibility:** Operates entirely within Node.js `crypto` standard library; external dependencies: **none**.
- **Data Model Changes:** Additive field in `OTPVerification`:
  ```prisma
  model OTPVerification {
    // ... existing fields
    pepperVersion Int @default(1) // Allows seamless rotation of server pepper
  }
  ```
- **Environment Variables (Names Only):**
  - `OTP_PEPPER` (64-character hex string)
  - `OTP_LOCKOUT_MAX_ATTEMPTS` (default: `10`)
  - `OTP_LOCKOUT_DURATION_SECONDS` (default: `1800` — 30 mins)
- **Fail-Closed Behavior:**
  - If `OTP_PEPPER` is missing or shorter than 32 bytes in production, the application refuses to boot or serve OTP endpoints.
  - Counter store read/write failure during verify → 503, code not evaluated / attempt not silently dropped (A1 b).
- **User-Facing Persian Messages:**
  - Wrong code: `«کد تایید وارد شده اشتباه است.»`
  - Single challenge exhausted: `«تعداد تلاش‌های مجاز برای این کد به پایان رسید. لطفاً کد جدید دریافت کنید.»`
  - Account/Phone locked out: `«به دلیل تلاش‌های ناموفق مکرر، ورود برای ۳۰ دقیقه مسدود شد. لطفاً بعداً تلاش فرمایید.»`
  - Verify service unavailable (A1, PROPOSED): `«سرویس تأیید موقتاً در دسترس نیست. لطفاً دقایقی دیگر تلاش کنید.»`
- **Tests:**
  1. Incorrect OTP submittal 3 times -> challenge locked.
  2. Requesting new OTP -> verify fail counter does not reset.
  3. 10 incorrect attempts across 4 challenges -> 30-minute lockout triggered.
  4. Comparison uses `timingSafeEqual` on equal-length buffers (code-level assertion; not a network timing proof).
  5. (A1) Counter store unreachable during verify -> 503; the code comparison function is NOT called (spy assertion).
  6. (A1) Counter write fails after a wrong code -> 503; response is not the normal "wrong code" body.
  7. (A1, only if backstop approved) Simulated Redis flush after 8 wrong attempts -> PostgreSQL backstop still locks at attempt 10.
  8. (A1) Redis restart with AOF preserves counters — **manual staging test, NOT automatable locally**; documented only.

---

### B.3 Session, JWT & State Mutation Protection

#### 1. Technical Design
1. **Algorithm Pinning:** Explicitly pin `HS256` on both `jwt.sign` and `jwt.verify`:
   ```typescript
   jwt.verify(token, secret, { algorithms: ['HS256'] });
   jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '2h' });
   ```
2. **Fail-Closed Secret Validation:** Remove `'fallback-secret-for-dev'`. In production, require `JWT_SECRET` with minimum 256 bits (32 characters).
3. **Session Cookie Architecture (Revision R1):**
   - **Production:** Name = `__Host-carno_session`, `Secure: true`, `HttpOnly: true`, `SameSite: 'Lax'`, `Path: '/'`, `Max-Age: 7200` (2 hours).
   - **Development (`localhost`):** Name = `carno_session`, `Secure: false`, `HttpOnly: true`, `SameSite: 'Lax'`, `Path: '/'`, `Max-Age: 7200`.
   - Cookie name and option selection is centralized in `getSessionCookieConfig()`.
4. **Server-Side Revocation (Session Table):**
   - Store active session ID (`jti`) in PostgreSQL.
   - On OTP re-verification, prior sessions for that user are invalidated (Session Fixation Defense).
   - Enables instant "Logout" and "Revoke All Sessions".
5. **Origin & CSRF Guard:**
   - Introduce Edge Middleware validating `Origin` and `Host` headers on all state-changing requests (`POST`, `PUT`, `DELETE`). Requests from unexpected origins are rejected with 403. Development mode explicitly allows `localhost` origins.

- **Decision Status:**
  - Algorithm Pinning & Helper-based Cookie Name: `CONFIRMED (R1)`
  - 2-Hour Access Token Lifetime: `CONFIRMED (D-F)`
- **Iran-compatibility:** Built into Next.js and standard Node.js libraries; external dependencies: **none**.
- **Data Model Changes:** Additive `Session` model (Phase C3):
  ```prisma
  model Session {
    id         String   @id @default(cuid())
    userId     String
    user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    jti        String   @unique
    userAgent  String?
    ipHash     String?
    expiresAt  DateTime
    revokedAt  DateTime?
    createdAt  DateTime @default(now())

    @@index([userId, revokedAt])
  }
  ```
- **Environment Variables (Names Only):**
  - `JWT_SECRET` (Primary active signing key, min 32 chars)
  - `JWT_SECRET_PREVIOUS` (Optional secondary key for zero-downtime rotation)
- **Fail-Closed Behavior:** Missing `JWT_SECRET` in production triggers immediate fatal boot exception.
- **User-Facing Persian Messages:**
  - Session expired / unauthorized: `«نشست کاربری شما منقضی شده است. لطفاً دوباره وارد شوید.»`
  - CSRF/Origin mismatch: `«درخواست نامعتبر از مبدأ غیرمجاز شناسایی شد.»`
- **Tests:**
  1. Token signed with `none` algorithm rejected.
  2. Token without `jti` in DB session table rejected.
  3. Development mode sets `carno_session` without Secure; production sets `__Host-carno_session` with Secure.
  4. Cross-origin POST request without matching Origin header returns 403.

---

### B.4 IDOR, Enumeration Prevention & Response Equivalence

#### 1. Technical Design
1. **Response-Equivalence Design Comparison & Recommendation (Revision R2, wording per A5):**
   - **Problem:** When an SMS gateway takes 500ms–2000ms to respond, a synchronous HTTP request can reveal whether an SMS was dispatched (new request) vs rejected by cooldown (~10ms).
   - **Design Comparison:**
     - *Design (a) Asynchronous Dispatch (RECOMMENDED):* Server creates the challenge, hands SMS dispatch to an in-process async task, and returns the uniform response without waiting for the gateway. Response time is **designed to avoid dependence on gateway latency**. Trade-off: gateway failures are not reported synchronously; the user relies on the resend countdown and delay hint.
     - *Design (b) Fixed Worst-Case Delay:* Delay all responses to exceed worst observed gateway latency (e.g. 1500ms). Trade-off: degrades mobile UX and fails whenever the gateway exceeds the chosen target.
   - **Recommended Design:** Design (a), with a small synthetic floor (~150ms) to reduce DB-lookup variance. `PROPOSED — NEEDS APPROVAL`.
   - **Honesty note:** this design reduces one known side-channel. It is not a guarantee of timing side-channel resistance in production; real-network measurement is NOT tested locally.
2. **Uniform Status Responses:**
   - Registration endpoint returns identical status codes and Persian messages whether the phone number is already a waitlist member, a new lead, or undergoing OTP resend.
3. **IDOR Prevention:**
   - Identity for `/api/waitlist/status` and `/api/payment/intent` is resolved strictly from `session.userId`.
   - No route accepts `phone` or `userId` as a query parameter or body payload to access user rank or status.
4. **Environment-Based Referral Link (Revision R2 / Audit 2.6):**
   - Replace hardcoded `https://carno.app` with `process.env.NEXT_PUBLIC_BASE_URL`.

- **Decision Status:**
  - IDOR rules (identity from session only) and `NEXT_PUBLIC_BASE_URL` referral fix: `CONFIRMED`.
  - Async-dispatch response design: `PROPOSED — NEEDS APPROVAL` *(corrected, see 2.4)*.
- **Iran-compatibility:** Server-side Node timer logic; external dependencies: **none**.
- **Data Model Changes:** None.
- **Environment Variables (Names Only):**
  - `NEXT_PUBLIC_BASE_URL` (e.g. `https://carno.ir` in prod, `http://localhost:3000` in dev).
- **Fail-Closed Behavior:** Requests lacking valid session token cannot query waitlist status under any circumstances.
- **User-Facing Persian Messages:**
  - Not authenticated: `«برای مشاهده وضعیت نوبت، لطفاً ابتدا شماره خود را وارد کنید.»`
- **Tests:**
  1. **Structural Response-Equivalence Test (A5):** for registered vs new phone, and for fresh vs cooldown request where feasible, verify identical status code, identical response body shape and text, identical headers (excluding `Date` and `Set-Cookie` values), and that response time does not depend on the SMS gateway call (mock gateway delay 0ms vs 2000ms yields the same response time within a loose tolerance). **Disclaimer:** regression guard only, NOT proof of timing side-channel resistance in production.
  2. Attempting to query rank of another user ID returns current user's rank or 401.

---

### B.5 Payment Webhook Security & Code Pool Bug Resolution

#### 1. Resolution of Payment Code Pool Bug (Audit Finding 3.1)
The current constraint `@@unique([uniqueCode, status])` coupled with expired intents remaining `status: 'PENDING'` leads to permanent exhaustion of all 999 codes.

**Redesigned Architecture:**
1. **Eager Expiration on Intent Creation:** Before allocating a new code, run an atomic update:
   ```sql
   UPDATE "PaymentIntent" SET "status" = 'EXPIRED' 
   WHERE "status" = 'PENDING' AND "expiresAt" < NOW();
   ```
2. **Single Active Intent Rule:** A user may possess at most **ONE** active `PENDING` payment intent at any time. Requesting a new intent while one is active returns the existing unexpired intent or requires explicitly cancelling it.
3. **Expanded Cent Pool Scheme:**
   - Expand `uniqueCode` range from `1–999` to `1000–9999` (9,000 discrete values).
   - Total payment amount: $299,000 + \text{code}$ (e.g., $299,000 + 4,321 = 303,321$ Toman).
   - An increase of up to 10,000 Tomans (~$0.15 USD) is entirely standard in Iranian card-to-card reservations and expands the concurrent active pool by 900%.

#### 2. Webhook Cryptographic Verification (HMAC + Replay Guard)
1. **HMAC Signature:** Webhook requests from n8n must include headers:
   - `X-Carno-Signature`: `HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, timestamp + "." + nonce + "." + rawBody)`
   - `X-Carno-Timestamp`: Epoch millisecond timestamp.
   - `X-Carno-Nonce`: Cryptographic random string.
2. **Timestamp Window:** Requests older than 300 seconds (5 minutes) or from the future are rejected.
3. **Nonce Cache:** Nonces are stored in Redis (`webhook:nonce:<nonce>`) with a 10-minute TTL. Duplicate nonces are rejected as replay attacks.
4. **IP Allowlist:** Request IP must originate from approved internal Docker network or configured static egress IP.
5. **Ambiguity & Anomaly Queue:** If an incoming bank SMS amount matches multiple intents or zero intents, the record is placed in `PaymentAnomalyLog` for human administrator review; it is never blindly credited.
6. **Production Disabled Flag (Decision D-E):** `/api/payment/*` is disabled in production (`ENABLE_PAYMENT_FLOW=false`) until the refund policy is approved.

- **Decision Status:**
  - Payment disabled by default in production: `CONFIRMED (D-E)`.
  - HMAC + timestamp + nonce, single-active-intent rule, eager expiry bug fix: `PROPOSED — NEEDS APPROVAL` (spec-level, scheduled C2).
  - Code-pool expansion to 1000–9999 (changes transferred amount): `PROPOSED — NEEDS APPROVAL` *(corrected, see 2.4)*.
- **Iran-compatibility:** Operates over local n8n and internal banking SMS forwarder; external dependencies: **none**.
- **Data Model Changes:**
  ```prisma
  model PaymentIntent {
    // ... existing fields
    // Ensure EXPIRED status transitions free up uniqueCode
    @@index([status, totalAmount, expiresAt])
  }

  model PaymentAnomalyLog {
    id          String   @id @default(cuid())
    rawAmount   Int
    referenceId String?
    rawPayload  Json
    reason      String   // NO_MATCH, MULTIPLE_MATCHES, EXPIRED_MATCH, SPOOF_SUSPECTED
    resolved    Boolean  @default(false)
    createdAt   DateTime @default(now())
  }
  ```
- **Environment Variables (Names Only):**
  - `ENABLE_PAYMENT_FLOW` (boolean: `false` by default)
  - `PAYMENT_WEBHOOK_SECRET` (minimum 32-character secret)
  - `PAYMENT_WEBHOOK_ALLOWED_IPS` (comma-separated IP list or `internal`)
- **Fail-Closed Behavior:** If signature, timestamp, or nonce is missing/invalid, returns 401 Unauthorized immediately.
- **User-Facing Persian Messages:**
  - Flow disabled: `«ثبت‌نام زودهنگام با پرداخت موقتاً غیرفعال است. جایگاه شما در صف عادی محفوظ است.»`
  - Existing intent active: `«شما یک سفارش پرداخت فعال دارید. لطفاً پرداخت قبلی را تکمیل کنید.»`
- **Tests:**
  1. Forged signature rejected (401).
  2. Timestamp > 300s rejected (401).
  3. Replayed nonce rejected (409 Conflict).
  4. Code pool recycled when intent expires.

---

### B.6 Referral Anti-Abuse & Point Integrity

#### 1. Technical Design
Referral points (+50 score) directly impact waitlist ranking. Attacker bots could farm points by generating synthetic accounts.

1. **Prerequisite:** Referral point award triggers **ONLY** after successful OTP verification.
2. **Self-Referral Prohibition:**
   - Same Phone: Inviter cannot be the invited user.
   - Same IP Cluster: If inviter and invitee share identical IP hash within a 1-hour window, the referral is marked `FLAGGED_PENDING_REVIEW` and points are held.
   - Same Device Cookie: If the browser contains an existing device token linked to the inviter, credit is rejected.
3. **Daily Soft Threshold & Velocity Flags (Decision D-D / Revision R5):**
   - **Soft Threshold: 20 successful referrals / 24 hours.**
   - Referrals up to 20/day enter the standard 24-hour maturity queue.
   - Referrals beyond 20 in 24 hours are not dropped; they are recorded with status `FLAGGED_HIGH_VOLUME` and held for manual review before points are applied.
   - Suspicious clusters (e.g. 5+ signups from the exact same device ID or subnet within 10 minutes) are flagged with `isFlagged: true` for administrative audit.
4. **Delayed Point Maturity (24h Window):**
   - Points are credited to `pendingScore` and mature to `priorityScore` after 24 hours. Existing point values (+50 / +200) remain strictly untouched.

- **Decision Status:** `CONFIRMED (D-D)`.
- **Iran-compatibility:** Executed within PostgreSQL transaction; external dependencies: **none**.
- **Data Model Changes:**
  ```prisma
  model Referral {
    // ... existing fields
    ipHash     String?
    deviceHash String?
    isFlagged  Boolean  @default(false)
    maturesAt  DateTime @default(now())
  }
  ```
- **Environment Variables (Names Only):**
  - `REFERRAL_DAILY_SOFT_CAP` (default: `20`)
  - `REFERRAL_MATURITY_HOURS` (default: `24`)
- **Fail-Closed Behavior:** Malformed or suspicious referral codes default to standard direct signup without crashing or attributing unearned points.
- **User-Facing Persian Messages:**
  - Referral self-invite: `«کد معرف وارد شده معتبر نیست.»`
- **Tests:**
  1. User inviting their own phone blocked.
  2. Rapid sequence of 25 referrals from one IP allows 20 and flags remaining 5 for review.

---

### B.7 Input Validation & Schema Strictness

#### 1. Technical Design (Decision D-B)
In accordance with owner decision **D-B**, input validation will be implemented using a **zero-dependency native TypeScript module** (`src/lib/validation/schemas.ts`). *Zod is not approved.*

1. **Validator Implementation:**
   - Deterministic type checking, string length bounds, and regular expressions.
   - Strip unrecognized object properties.
   - Enforce max payload sizes (`16KB` for JSON endpoints).
2. **Validation Schemas:**
   - `WaitlistRegisterSchema`:
     - `phone`: non-empty string, normalized via `normalizeIranianPhone`, matches `/^09\d{9}$/`.
     - `powSolution`: non-empty string, length <= 128.
     - `honeypot`: must be empty string / undefined.
     - `timeToken`: signed timestamp proving > 1.5s fill duration.
   - `WaitlistVerifySchema`:
     - `phone`: valid Iranian mobile.
     - `otp`: string matching `/^\d{5}$/`.
     - `referredByCode`: optional string, alphanumeric, length 6–12.
     - `source`: optional string, length <= 50.

- **Decision Status:** `CONFIRMED (D-B)`.
- **Iran-compatibility:** Pure native JavaScript/TypeScript runtime; external dependencies: **none**.
- **Data Model Changes:** None.
- **Environment Variables:** None.
- **Fail-Closed Behavior:** Any unexpected type, extra key, or out-of-range value returns 400 Bad Request immediately.
- **User-Facing Persian Messages:**
  - Malformed payload: `«اطلاعات ارسال‌شده معتبر نیست. لطفاً ورودی‌ها را بررسی فرمایید.»`
- **Tests:** Payload fuzzing test injecting unexpected keys, script tags, and oversized strings.

---

### B.8 PII Protection & Dual-Write Database Migration Plan

#### 1. Technical Design
Protects Iranian citizens' phone numbers in compliance with privacy best practices.

1. **Field-Level Encryption (AES-256-GCM):**
   - Phone numbers in `User` and `OTPVerification` are encrypted using authenticated AES-256-GCM before writing to PostgreSQL.
   - Encryption key (`PII_ENCRYPTION_KEY`) resides exclusively in server environment memory.
2. **Deterministic Blind Index (HMAC-SHA256):**
   - Because AES-GCM produces randomized ciphertexts (using unique IVs), exact-match search cannot query encrypted text directly.
   - Solution: Compute a blind index `phoneBidx = HMAC-SHA256(PII_BLIND_INDEX_KEY, normalizedPhone)`.
   - The blind index is stored as `@unique` for fast, secure lookups without exposing plaintext phone numbers.

#### 2. Reversible Dual-Write Migration Sequence & Lifecycle Completeness (Revision R7)
> [!CRITICAL]
> **PII Lifecycle Completeness Statement (R7):**  
> Encrypting data in new columns while retaining plaintext `phone` is merely a transition phase. **Until the plaintext column is permanently dropped and all old backups/dumps containing plaintext are purged, data privacy goals are NOT MET.** That final destruction requires explicit human authorization and verified offline cold-storage backup.

```text
Step 1: Additive Schema Migration (Phase C4)
        Add columns: phoneEncrypted String?, phoneBidx String? @unique, phoneIv String?
        Keep original plaintext 'phone' column intact.

Step 2: Dual-Write Application Logic
        New signups write to BOTH plaintext 'phone' AND ('phoneEncrypted', 'phoneBidx').
        Reads fall back to 'phone' if 'phoneEncrypted' is null.

Step 3: Idempotent Backfill Script
        Background script reads unencrypted rows in batches of 100,
        encrypts phone, generates blind index, updates row.

Step 4: Verification & Consistency Check
        Automated script asserts 100% of rows have matching decrypted phone == plaintext phone.

Step 5: Cutover (Read from Encrypted)
        Switch read queries to look up via 'phoneBidx' and decrypt 'phoneEncrypted'.
        Plaintext column remains as read-only backup.

Step 6: Scheduled Plaintext Purge (Requires Separate Human Approval)
        After 30 days of verified cutover operation:
        - Verify cold-storage encrypted backup exists.
        - Execute migration: ALTER TABLE "User" DROP COLUMN "phone";
        - Execute migration: ALTER TABLE "OTPVerification" DROP COLUMN "phone";
        - Purge legacy development database dumps.
```

- **Decision Status:** `PROPOSED — NEEDS APPROVAL (P8)`.
- **Iran-compatibility:** Node.js native `crypto` library; data residency completely inside Iran; external dependencies: **none**.
- **Data Model Changes (Additive):**
  ```prisma
  model User {
    // ...
    phoneEncrypted String?
    phoneBidx      String? @unique
    phoneIv        String?
  }
  ```
- **Environment Variables (Names Only):**
  - `PII_ENCRYPTION_KEY` (32-byte / 64-hex string)
  - `PII_BLIND_INDEX_KEY` (32-byte / 64-hex string)
- **Fail-Closed Behavior:** If encryption keys are missing, server halts.

---

### B.9 Security Headers, Content-Security-Policy & Self-Hosting

#### 1. Technical Design & Frozen Hero Compatibility (Revision R3)
The Content-Security-Policy (CSP) must protect against XSS and clickjacking while ensuring the 120-frame vehicle engine (`CanvasRenderer`, `BitmapCache`, `ImageBitmap`) functions without interruption.

> [!NOTE]
> **CSP Honesty Statement (Revision R3):**  
> The directive `script-src 'self' 'unsafe-inline'` is an **EXPLICIT COMPROMISE**, not a strict policy. Next.js 15+ App Router emits inline runtime hydration scripts and chunk loaders that require `'unsafe-inline'` unless a dynamic nonce is injected per-request via Next.js Edge Middleware. Nonce-based CSP is scheduled as a future architectural enhancement.

```typescript
// next.config.ts production headers configuration
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // COMPROMISE: Required for Next.js hydration scripts
      "style-src 'self' 'unsafe-inline'",  // COMPROMISE: Required for Tailwind & Next.js CSS injection
      "img-src 'self' data: blob:",        // CRITICAL: blob: and data: required for car frames canvas pipeline
      "font-src 'self'",                   // Self-hosted fonts only
      "connect-src 'self'",                // API routes only (no foreign tracking endpoints)
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];
```

2. **Next.js Hardening Flags:**
   - `poweredByHeader: false` (Strips `X-Powered-By: Next.js`).
   - `productionBrowserSourceMaps: false` (Ensures server internals/source maps are not exposed).
3. **Local Font Migration:**
   - Migrate `Vazirmatn` from `next/font/google` to `next/font/local` using bundled `.woff2` files stored in `public/fonts/`. Eliminates Google servers build-time download dependency.
4. **Verification Step for `unsafe-eval` (R3):**
   - Execute production build with strict CSP omitting `'unsafe-eval'`. Automated Playwright/browser test asserts that the GSAP scroll animations and vehicle canvas render without triggering `SecurityPolicyViolationEvent`.

- **Decision Status:** `CONFIRMED (R3)`.
- **Iran-compatibility:** Removes all foreign CDN requests; external dependencies: **none**.

---

### B.10 Monitoring, Auditing & Iran-Reachable Alerting

#### 1. Technical Design & Reserved Alert Budget (Revision R4)
External SaaS monitoring tools (Sentry Cloud, Datadog) are filtered or blocked from Iranian servers.

1. **Structured JSON Logging:**
   - All server events output machine-parseable JSON to `stdout` containing: timestamp, event type, masked phone, IP hash, status code, and latency.
   - PII is automatically scrubbed (zero plaintext phone numbers or passwords).
2. **Reserved Alert Budget (R4):**
   - To resolve the circular failure where SMS pumping exhausts the SMS gateway budget and blocks alert delivery:
     - **Separate Alert Quota:** A distinct, dedicated monthly alert balance is allocated in the MeliPayamak panel specifically for administrative notifications.
     - **Pre-Approved Alert Pattern:** A dedicated pattern (e.g. `کد هشدار: {1} - رخداد: {2}`) must be approved by the human owner in the SMS panel for administrative alerts.
3. **Domestic Multi-Channel Alert Dispatcher:**
   - When anomalous thresholds are exceeded, the alert engine dispatches notifications through at least two independent domestic channels:
     - **Channel A (Primary):** SMS alert to system administrator phone via dedicated alert pattern.
     - **Channel B (Equal First-Class Channel - R4):** Domestic SMTP Email (e.g. via Iranian mail provider or self-hosted Postfix) with zero dependency on telecom lines.
     - **Channel C (Secondary Domestic Messenger):** Bale Messenger Bot API or Eitaa Bot API — *Requires human token configuration*.
4. **Alert Triggers:**
   - Global SMS consumption reaches 80% and 100% of daily cap.
   - OTP verification failure rate exceeds 25% over a 5-minute sliding window.
   - Payment webhook receives invalid signature or replayed nonce.
   - SMS Kill Switch is toggled.

- **Decision Status:** `PROPOSED — NEEDS APPROVAL (P6)`.
- **Iran-compatibility:** Operates over domestic SMS, Iranian SMTP, and Iranian messengers; external dependencies: **none**.
- **Data Model Changes:** Additive `SecurityAuditLog` table for tamper-evident event logging.
- **Environment Variables (Names Only):**
  - `ALERT_ADMIN_PHONE` (Mobile number of system owner)
  - `ALERT_MELIPAYAMAK_BODY_ID` (Approved pattern ID for administrative alerts)
  - `ALERT_SMTP_HOST` / `ALERT_SMTP_PORT` / `ALERT_SMTP_USER` / `ALERT_SMTP_PASS`
  - `BALE_BOT_TOKEN` / `BALE_CHAT_ID` (Optional domestic messenger)

---

### B.11 Business Logic & Algorithm Extraction Resistance

#### 1. Architectural Safeguards
Carno's proprietary value resides in its used car opportunity scoring algorithms, asking-price valuation models, and seller behavior detection signals.

1. **Zero Client Inference:**
   - Analytical models, score weights, and algorithmic rules run exclusively inside secure server-side runtimes.
   - The client browser receives only final calculated presentation metrics (e.g. `opportunityScore: 87`).
2. **Quota & Rate Caps on Future Analysis Endpoints:**
   - Future valuation endpoints (`/api/analyze/car`) must require active session tokens, enforce per-user daily evaluation quotas (e.g. 10 queries/day for free users), and rate-limit against automated scrapers.

- **Decision Status:** `CONFIRMED`.
- **Iran-compatibility:** Server-side evaluation; external dependencies: **none**.

---

### B.12 Comprehensive Test Plan

Testing must be executed locally without contacting external third-party gateways.

| Test Scenario | Target Module | Method & Verification Criterion |
| :--- | :--- | :--- |
| **SMS Rate Limiting & CGNAT** | `src/lib/sms/limiter.ts` | Simulate 50 concurrent requests from 1 IP across 5 virtual devices. Verify cutoff at 20 requests; verify device cookies isolated. |
| **Redis Outage Fail-Closed** | `src/lib/sms/index.ts` | Simulate Redis connection error in production mode. Verify `/api/waitlist/register` returns 503 without sending SMS. |
| **Development Fallback** | `src/lib/sms/limiter.ts` | Run in `NODE_ENV=development` with Redis disconnected. Verify in-memory sliding window operates cleanly. |
| **OTP Brute-Force Lockout** | `/api/waitlist/verify` | Submit 10 invalid OTPs across 4 newly requested challenges for the same phone. Verify 30-minute lockout is triggered. |
| **Verify Fail-Closed on Counter Read (A1)** | `/api/waitlist/verify` | Make counter store unreachable. Verify 503 and that the code comparison is never invoked. |
| **Verify Fail-Closed on Counter Write (A1)** | `/api/waitlist/verify` | Submit wrong code with increment write failing. Verify 503, not the normal "wrong code" response. |
| **PostgreSQL Backstop (A1, if approved)** | `/api/waitlist/verify` | 8 wrong attempts, flush Redis, 2 more wrong attempts. Verify lock at 10. |
| **Redis AOF Restart (A1)** | Staging only | Restart Redis with AOF on; counters preserved. **Manual, NOT automatable locally.** |
| **Device-Cookie Rotation (A2)** | `/api/waitlist/register` | New cookie per request. Verify per-phone, per-IP and global caps still enforce. |
| **Spoofed Trusted Header (A3)** | IP resolver | Header from peer outside `TRUSTED_PROXY_CIDRS` ignored; header ignored when CIDRs empty in production; XFF right-most-untrusted logic. |
| **Structural Response-Equivalence (A5)** | `/api/waitlist/register` | Same status, body, headers (excl. Date/Set-Cookie value) for registered vs new phone; mock gateway 0ms vs 2000ms yields same response time within loose tolerance. Regression guard only, not a timing-security proof. |
| **Payment Code Pool Recycling** | `src/app/api/payment/intent` | Create intent, artificially expire in DB, create new intent. Verify previously consumed unique code is successfully reallocated. |
| **Payment Webhook Forgery** | `/api/payment/webhook` | Send requests with altered payload, expired timestamp (>300s), and repeated nonce. Verify all return 401/409. |
| **CSP & Frozen Engine** | `next.config.ts` | Build production bundle. Launch local server. Verify canvas renders all 120 frames without CSP errors. |
| **PoW Challenge Benchmark** | In-House PoW Solver | Execute Proof-of-Work solver on simulated low-end CPU throttle (4x slowdown). Verify solve completes in < 2.5 seconds. |

---

### B.13 Rollout & Rollback Architecture (Phases C1 – C4)

```text
Phase C1: SMS Abuse Protection & OTP Hardening
  ├── Scope: /api/waitlist/register, /api/waitlist/verify, in-house PoW, ioredis limiter,
  │          verify fail-closed (A1 b), trusted-IP resolver (A3), MeliPayamak only (A4)
  ├── Migration: Additive column pepperVersion to OTPVerification
  │          (+ OtpFailureCounter table ONLY if A1 c backstop is approved)
  ├── Out of scope (A4): secondary SMS provider, real alert channels, analytics, fonts,
  │          CSP/headers, session/JWT, referral, PII encryption, payment, Telegram link,
  │          Sample Analysis card
  └── Rollback: Revert C1 commit; database change is backward-compatible

Phase C2: Payment Webhook Security & Code Pool Fixes
  ├── Scope: /api/payment/intent, /api/payment/webhook, code pool recycling
  ├── Migration: Add PaymentAnomalyLog, update unique indexes
  └── Rollback: Revert C2 commit; payment flow remains disabled (ENABLE_PAYMENT_FLOW=false)

Phase C3: Session Security, IDOR & Referral Soft Cap
  ├── Scope: /api/waitlist/status, middleware.ts, session table
  ├── Migration: Add Session table, add Referral tracking columns
  └── Rollback: Revert C3 commit

Phase C4: PII Encryption, Security Headers & Observability
  ├── Scope: next.config.ts, local fonts, dual-write encryption backfill
  ├── Migration: Add phoneEncrypted and phoneBidx; execute dual-write backfill
  └── Rollback: Switch cutover flag to read from legacy column; revert headers
```

---

## 4. External URL Inventory & Self-Hosted Replacement Plan

Audit of all external URLs discovered in the codebase:

| Discovered External Host | Current File & Line | Purpose | Iranian / Self-Hosted Replacement | Action Required |
| :--- | :--- | :--- | :--- | :--- |
| `https://app.posthog.com` | `AnalyticsProvider.tsx:10` | Analytics Tracking | Disable foreign host in production. Replace with self-hosted PostHog instance inside Iran or local structured events. | Remove foreign endpoint |
| `https://www.googletagmanager.com` | `AnalyticsProvider.tsx:24` | Google Analytics | Filtered/blocked in Iran. Remove script tag. | Remove script tag |
| `https://www.clarity.ms` | `AnalyticsProvider.tsx:42` | Microsoft Clarity | Filtered/unreliable in Iran. Remove script tag. | Remove script tag |
| `https://fonts.googleapis.com` (via `next/font/google`) | `src/app/layout.tsx:2` | Vazirmatn Font | Replace with `next/font/local` using self-hosted `.woff2` files in `public/fonts/`. | Migrate to local font |
| `https://t.me/jeyhub_support` (Revision R8) | `TrustSection.tsx:72`, `FooterSection.tsx:57` | Support Link | Filtered in Iran. Propose UI update placing domestic channel (Bale / Phone / Email) as primary and Telegram as secondary. | Requires human copy approval |
| `https://rest.payamak-panel.com` | `src/lib/sms/melipayamak.ts:6` | Domestic SMS API | Iranian domestic IP. Keep active. | Retain as primary SMS gateway |

### 4.1 Sample Analysis Card — Pre-Launch Decision (NOT part of C1–C4) — Amendment A6

**Finding (no edit made):** `src/features/carno-experience/sections/SampleAnalysisSection.tsx` contains hard-coded illustrative values:
- Listing description: «پژو ۲۰۷i دنده‌ای · مدل ۱۴۰۲ (سفید)» and «کارکرد: ۲۸٬۰۰۰ کیلومتر · بدون رنگ»
- Price claim: «حدود ۴٪ زیر میانگین بازار» and the 30-day market comparison sentence
- Opportunity score: «۸۷» «از ۱۰۰» with an 87% gauge width
- Seller-signal sentence: «احتمال نوع فروشنده: بر اساس الگوی ثبت آگهی، احتمال فروشنده شخصی بالاست.»

**Policy:** these values are acceptable ONLY while the card carries the in-card label «نمونه نمایشی از خروجی Carno» and a footnote stating the values are illustrative.

**Pre-public-launch gate:** before any public traffic, ads, or payment activation, the owner must choose ONE of:
1. Replace with a sanitized real engine output.
2. Replace numeric claims with non-numeric structural placeholders (layout with no specific percentage or score).
3. Keep as a labeled demo, with explicit owner sign-off recorded in this spec (name, date).

**Status:** `PENDING OWNER DECISION`. No code change in this task.

**Residual risk:** the headline claim «با عدد، نه با حدس» next to an invented number is a trust risk if the label or footnote is ever removed, cropped in a screenshot, or reused in ads.

---

## 5. Infrastructure Hardening Checklist (For System Administrator)

> [!NOTE]
> This section is documentation for the human infrastructure administrator. As per instructions, the coding assistant will NOT edit `docker-compose.yml` or server configuration files.

1. **PostgreSQL Network Exposure:**
   - Currently, `docker-compose.yml` maps `5433:5432` to `0.0.0.0`.
   - **Action:** Bind to localhost only: `127.0.0.1:5433:5432` or isolate inside Docker bridge network without exposing host ports.
   - Change default password `postgres:postgres` to a high-entropy secret.
2. **Redis Hardening (updated per A1):**
   - Private network only: bind to `127.0.0.1` or the internal Docker network; no published host port in production.
   - Enable `requirepass` (or ACL user) and pass it via env only.
   - AOF persistence on: `appendonly yes`, `appendfsync everysec` (or `always`).
   - `maxmemory-policy noeviction` on the instance holding security counters (lockout keys must never be evicted).
   - Note: AOF reduces but does not eliminate counter loss; verify remains fail-closed regardless.
3. **Reverse Proxy & Edge WAF (updated per A3):**
   - Place an Iranian edge CDN/WAF (e.g. ArvanCloud, Derak, or Fanava — examples, `PENDING P1`) in front of the Next.js server to absorb L4/L7 volumetric DDoS attacks.
   - Set `TRUSTED_IP_HEADER` to the header the chosen edge sends, and `TRUSTED_PROXY_CIDRS` to that provider's published egress ranges (`PENDING — depends on P1`; do not guess).
   - **Firewall the origin** so HTTP(S) is accepted ONLY from the edge provider ranges. Otherwise an attacker can bypass the edge, hit the origin directly, and spoof the client-IP header.
4. **n8n Isolation:**
   - Keep n8n on internal Docker network. Webhook calls to Next.js should resolve via internal container networking `http://app:3000/api/payment/webhook`.

---

## 6. Iranian Legal & Privacy Compliance Requirements

*(Marked: ALL ITEMS PENDING LEGAL REVIEW — Revision R9)*

1. **Promotional SMS Regulations (PENDING LEGAL REVIEW):**
   - Under Iranian telecommunications framework, service line SMS messages must be strictly confined to OTP authentication and transactional status receipts.
   - Waitlist registration copy must explicitly clarify that phone numbers will not be enrolled into marketing broadcasts without separate affirmative consent.
2. **User Data Deletion Request Path (PENDING LEGAL REVIEW):**
   - E-commerce privacy best practices in Iran require providing users with an accessible mechanism to request data deletion.
   - A dedicated privacy contact address (e.g. `privacy@[confirmed-domain]`) should be established in the footer upon domain confirmation.

---

## 7. Open Questions for Human Review (PENDING P1 – P9)

The following items are officially classified as `PENDING` awaiting human stakeholder decisions before implementation:

- **[P1] Production Hosting Provider:** Which Iranian cloud/datacenter hosts the production instance (ArvanCloud, Asiatech, Afranet, Parspack)? **Also blocks:** the `TRUSTED_PROXY_CIDRS` list and trusted header name (A3), and therefore production rollout of the per-IP tier behind an edge.
- **[P2] Analytics Strategy:** Should analytics default to zero external scripts, or will a self-hosted PostHog/Matomo server be deployed?
- **[P3] Formal Shaparak Gateway:** What is the target timeline for acquiring Enamad and migrating to an official IPG (ZarinPal, NextPay, IDPay)?
- **[P4] Production Redis Availability (BLOCKS C1 PRODUCTION ROLLOUT):** Please confirm production Redis connection string and authentication password. *(Does not block local development).*
- **[P5] Secondary SMS Provider:** Which secondary provider is preferred for failover (Kavenegar or Ghasedak)?
- **[P6] Domestic Alert Channels:** Please provide system owner alert mobile number, approve alert SMS pattern in panel, and provide domestic SMTP credentials.
- **[P7] Legal Review of Privacy Terms:** Formal legal review of user consent copy and promotional SMS disclaimers.
- **[P8] Authorization for Database Encryption:** Explicit approval to apply additive encryption columns in Phase C4.
- **[P9] Security Contact & Official Domain:** Confirm official domain (e.g. `carno.ir` vs `carno.app`) and security contact email for `security.txt`.
- **[P10] Sample Analysis Card (A6):** Choose option 1, 2 or 3 in Section 4.1 before public launch.
- **[P11] Pre-Launch SMS Queue & Worker Hardening (TODO قبل از انتشار عمومی):** انتخاب نهایی معماری صف پیامک قبل از انتشار عمومی: (۱) صف توزیع‌شده‌ی کاملاً قابل‌اتکا با استفاده از الگوی `BRPOPLPUSH` / `RPOPLPUSH` و پردازشگر مجزا (Standalone Worker Daemon) با لیست processing و بازیابی jobهای معلق پس از راه‌اندازی مجدد سرور، یا (۲) بازگشت به ارسال مستقیم در همان درخواست با سقف زمانی سخت (Strict Timeout).
- **[UX-C1] بهبود پیام خطای ارسال پیامک:** اضافه کردن بررسی وضعیت در کلاینت؛ چنانچه `sms:status = failed` باشد، به جای اتکای صرف به فعال‌سازی زودهنگام دکمه، پیام صریح «ارسال کد با مشکل مواجه شد، دوباره تلاش کنید» نمایش داده شود.

**Gate 2 Approved Items Recorded:**
- PostgreSQL backstop for OTP lockout (A1 c): **APPROVED**
- Verify-unavailable Persian message (A1): **APPROVED**
- Low verify-ratio alert threshold (< 20% verified over 1h) (A2): **APPROVED**

---

## 8. Dependencies Requested

| Package / Tool | Purpose | No-Dependency Alternative | Status |
| :--- | :--- | :--- | :--- |
| **`ioredis`** | High-performance Redis client for atomic rate limiting Lua scripts | Standard `node-redis` or PostgreSQL-based sliding window | **APPROVED BY OWNER (D-C)** |
| **`altcha`** | Proof-of-Work bot challenge widget | In-house PoW module using Node `crypto` and Web Worker | **REJECTED BY OWNER (D-A)** |
| **`zod`** | Schema validation | Native TypeScript parsing & regex validation functions | **REJECTED BY OWNER (D-B)** |

---

## 9. What This Specification Deliberately Does NOT Cover

- Visual redesign of approved Hero, 3D Canvas, or Conversion Sections.
- Modifications to 120-frame vehicle animation engine or assets.
- Live connections to real Iranian payment gateways (delayed until legal refund terms are defined).
- Live SMS transmission tests to real handsets (mock tests only during development).

---

## 10. Phase B Completion & Boundary Check

```bash
git diff --stat -- src/features/carno-experience/engine public/car-frames
# Output: (empty — 0 files changed)
```

**PHASE B REVISION + AMENDMENTS A1–A6 COMPLETE.**  
Work is now **STOPPED**. Awaiting explicit human instruction: `"Approved — proceed to C1 implementation"`.
