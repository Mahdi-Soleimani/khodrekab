# Carno — Backend Security Audit (Phase A)
## Read-Only Forensic & Architecture Security Analysis

> **Project:** Carno / کارنو  
> **Repository:** `radifo-khodro-landing`  
> **Base Branch:** `conversion-redesign` (Clean commit: `aeb5da2`)  
> **Active Work Branch:** `security-hardening`  
> **Audit Status:** Phase A Complete — Read-Only (Zero Code/DB Changes)  
> **Document Purpose:** Ground-truth security baseline and vulnerability audit covering OTP, SMS, waitlist, referral, session, payment, PII, headers, and threat modeling.

---

## 1. Executive Summary & Audit Scope

This document represents **Phase A (Read-Only Security Audit)** of the Carno Security Hardening roadmap. All findings documented herein were verified through direct static and runtime code inspection of the active codebase. 

No application code, dependencies, environment files, or database schemas were modified during this phase.

```bash
# Pre-Flight Verification
Base Commit: aeb5da27dfe694a52e8de370b78a1cfd938c85fc
Active Branch: security-hardening
Working Tree Status: Clean (0 uncommitted changes prior to audit document creation)
```

---

## A.1 Complete Endpoint & Server Action Inventory

| Identifier / Path | Type / Method | Auth Requirement | Inputs | Outputs / Response | Side Effects | Cost / Financial Implication |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`/api/waitlist/register`** | Route Handler (`POST`) | Public (Unauthenticated) | JSON `{ phone: string }` | `{ success: true, message: string, maskedPhone: string }` or `{ error: string }` | Normalizes phone, hashes OTP (bcrypt), stores in DB (`OTPVerification`), dispatches SMS via `smsService.sendOtp` | **High Cost:** Triggers outbound SMS via MeliPayamak gateway on each allowed request. Direct risk of SMS pumping. |
| **`/api/waitlist/verify`** | Route Handler (`POST`) | Public (Unauthenticated) | JSON `{ phone, otp, referredByCode?, source? }` | `{ success: true, message: string }` + `Set-Cookie: token` or `{ error: string }` | Validates OTP hash, marks `verified: true`, creates/updates `User` & `WaitlistEntry`, applies referral score (+50), signs 7d JWT, sets `httpOnly` cookie | No direct external cost, but creates accounts, issues sessions, and awards priority rank. |
| **`/api/waitlist/status`** | Route Handler (`GET`) | Authenticated (JWT `token` cookie) | HTTP Cookie `token` | `{ success: true, data: { rank, refCode, referralCount, status } }` | Queries DB for user rank calculation and referral counts | Low computation cost, but vulnerable to unbounded polling/scraping. |
| **`/api/payment/intent`** | Route Handler (`POST`) | Authenticated (JWT `token` cookie) | HTTP Cookie `token` | `{ success: true, data: { intentId, totalAmount, uniqueCode, expiresAt } }` | Generates pseudo-random 1-999 `uniqueCode`, creates `PaymentIntent` (PENDING, 15m expiry) | Direct business impact; manages financial transaction reservation (299,000 + uniqueCode). |
| **`/api/payment/webhook`** | Route Handler (`POST`) | Shared Secret (`Authorization: Bearer <secret>`) | JSON `{ amount, referenceId, date }` | `{ success: true, message: string }` or `{ error: string }` | Finds pending `PaymentIntent` by amount, marks `PAID`, logs to `PaymentLog`, upgrades user to `EARLY_ACCESS` | **Critical Financial Impact:** Upgrades user to paid tier based on matching incoming amount. |
| **`sendOtpAction`** (`src/app/actions/auth.ts`) | Server Action (`POST`) | Public (Unauthenticated) | `phoneNumber: string` | `{ success: boolean, error?: string }` | Normalizes phone, hashes OTP, creates `OTPVerification`, dispatches SMS via `smsService.sendOtp` | **High Cost:** Outbound SMS. (Legacy action redundant with `/api/waitlist/register`). |
| **`verifyOtpAction`** (`src/app/actions/auth.ts`) | Server Action (`POST`) | Public (Unauthenticated) | `phoneNumber, code, referredByCode?, source?` | `{ success: boolean, waitlist_position?: number, error?: string }` | Validates OTP, updates DB, creates `User` & `WaitlistEntry`, calculates rank | No cookie issued (defective legacy action). |
| **Analytics (`AnalyticsProvider.tsx`)** | Client Provider | Public | Client browser context | Initializes PostHog, Google Analytics, Microsoft Clarity | Captures `landing_view` | Third-party analytics tracking. |
| **`CarnoAnalytics`** (`useCarnoExperience.ts`) | Internal Abstraction | Public | Client browser context | Console debug output | None (debug logging abstraction) | Zero cost. |
| **Middleware (`middleware.ts`)** | Edge Middleware | **DOES NOT EXIST** | N/A | N/A | None | **Missing Layer:** No central edge auth, header injection, or IP rate limiting. |

---

## A.2 Current Security Controls Assessment (Verified in Code)

| Control Area | Current Implementation State in Code | Assessment & Gap Analysis |
| :--- | :--- | :--- |
| **Rate Limiting** | • In `/api/waitlist/register`: Prisma query checks if an unverified OTP was created for the same phone within the last 60 seconds (`createdAt: { gt: now - 60s }`).<br>• In `/api/waitlist/verify`: Checks `attempts >= 3` on the current challenge.<br>• In `/api/waitlist/status`, `/api/payment/intent`, `/api/payment/webhook`: **None.** | **CRITICAL GAP:**<br>1. No rate limiting by client IP or ASN.<br>2. No global hourly or daily SMS cap.<br>3. No Redis rate limiting (Redis container is in docker-compose but completely unused in application code).<br>4. Attacker can cycle through arbitrary phone numbers to flood SMS gateway without IP restrictions. |
| **OTP Generation & Hashing** | • Generated via `crypto.randomInt(10000, 100000)` (5-digit numeric string: `10000` to `99999`).<br>• Hashed using `bcryptjs` with 10 salt rounds.<br>• Expiry: 5 minutes.<br>• Stored in table `OTPVerification`. | **HIGH VULNERABILITY:**<br>Bcrypt without a secret pepper over a 5-digit keyspace (only 90,000 possible values) is computationally trivial to crack with GPUs if the database is leaked. HMAC-SHA256 with an environment pepper is needed. |
| **OTP Replay & Attempts** | • Immediate `verified: true` set upon successful validation.<br>• `attempts` incremented on failed comparison; lockout after 3 attempts on that specific record.<br>• New request marks prior challenges as `verified: true`. | **GAP:**<br>Requesting a new OTP creates a fresh challenge record with `attempts = 0`, resetting the per-challenge attempt limit. No persistent lockout exists across multiple OTP challenges for a single phone. |
| **Timing-Safe Comparison** | • OTP verification uses `bcrypt.compare` (constant time).<br>• Webhook authorization uses standard string comparison: `authHeader !== \`Bearer \${process.env.PAYMENT_WEBHOOK_SECRET}\``. | **MEDIUM RISK:**<br>Webhook bearer token check is vulnerable to timing side-channel analysis. Must use `crypto.timingSafeEqual`. |
| **Phone Normalization** | • Central utility `normalizeIranianPhone` converts Persian/Arabic digits, removes punctuation/spaces, normalizes `+98`/`0098`/`98`/`9...`, and validates `^09\d{9}$`. | **ROBUST:**<br>Prevents format bypasses and canonicalizes phone storage. |
| **JWT & Session Management** | • Signed with `jwt.sign({ id, phone }, JWT_SECRET, { expiresIn: '7d' })`.<br>• Cookie flags: `httpOnly: true`, `sameSite: 'lax'`, `secure: process.env.NODE_ENV === 'production'`, `path: '/'`.<br>• Cookie name: `token`. | **HIGH RISK:**<br>1. Hardcoded fallback: `process.env.JWT_SECRET \|\| 'fallback-secret-for-dev'`. If `JWT_SECRET` is omitted in production, forged tokens signed with fallback are accepted.<br>2. Algorithm is not pinned during verification (`jwt.verify(token, JWT_SECRET)` without `{ algorithms: ['HS256'] }`).<br>3. 7-day token is long-lived with zero server-side revocation or session tracking table.<br>4. Cookie lacks `__Host-` prefix. |
| **CSRF / Origin Validation** | • Server Actions have Next.js default origin checks.<br>• API Route Handlers (`/api/waitlist/*`, `/api/payment/*`) have **ZERO** `Origin` or `Host` checks. | **HIGH RISK:**<br>State-changing POST endpoints accept cross-site requests if browser credentials/cookies are attached. |
| **Input Validation** | • Handled via manual string trimming and conditional checks (`typeof`, regex).<br>• No schema validation library (Zod) is installed or used. | **MEDIUM RISK:**<br>Risk of unexpected object injections or unhandled null/undefined fields. |
| **Enumeration Protection** | • `/api/waitlist/register` returns identical success message whether the phone is already in waitlist or new.<br>• `/api/waitlist/status` requires valid session cookie. | **GOOD:**<br>Public registration does not reveal if a phone is registered. |
| **IDOR Exposure** | • `/api/waitlist/status` and `/api/payment/intent` derive identity solely from `decoded.id` inside verified JWT.<br>• No endpoint accepts arbitrary `userId` to view or mutate another account. | **GOOD ARCHITECTURE:**<br>Session-bound identity prevents direct object reference attacks on status. |
| **Prisma & SQL Safety** | • No `$queryRaw` or `$queryRawUnsafe` in the repository.<br>• 100% of queries use Prisma Client typed parameterization. | **ROBUST:**<br>Protected against SQL injection. |
| **Database Privileges & Network** | • Default `DATABASE_URL` connects as superuser `postgres:postgres`.<br>• `docker-compose.yml` exposes PostgreSQL on `0.0.0.0:5433->5432`. | **HIGH RISK:**<br>Database port is bound to all host network interfaces. Unauthenticated host network attackers can brute-force the default postgres password. |
| **Security Headers & CSP** | • `next.config.ts` is empty.<br>• Zero security headers configured (No HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, X-Frame-Options).<br>• No Content-Security-Policy (CSP). | **HIGH RISK:**<br>Missing standard web defense headers. `X-Powered-By: Next.js` is exposed. |
| **Production Source Maps** | • `productionBrowserSourceMaps` is not configured (defaults to false in Next.js, but unpinned). | **LOW RISK:**<br>Must be explicitly pinned to `false`. |
| **Secrets Handling** | • `.env` is ignored by git and docker.<br>• Server secrets (`MELIPAYAMAK_*`, `DATABASE_URL`, `JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`) are never exposed via `NEXT_PUBLIC_`. | **GOOD:**<br>Secrets boundary is maintained. |
| **PostHog & Analytics PII** | • Events captured: `landing_view`, `phone_submitted`, `otp_sent`, `otp_verified`, `waitlist_position_viewed`, `referral_shared`, `payment_started`.<br>• Raw phone numbers are **NEVER** sent to PostHog. | **GOOD:**<br>No PII transmitted to external analytics providers. |
| **Logging Security** | • Server logs use `maskPhone(phone)` (`0912***6789`).<br>• Plaintext OTPs, tokens, and gateway passwords are **NOT** logged to console. | **GOOD:**<br>Logging meets privacy criteria. |
| **Dependency Health** | • `npm audit` reveals 5 high-severity vulnerabilities in development build chain (`braces` via `micromatch` in `eslint-config-next`). Production dependencies are clean. | **LOW RUNTIME RISK:**<br>Dev-dependency issue only; runtime bundle is unaffected. |

---

## A.3 Payment Flow Forensic Deep-Dive

### 1. Mechanism Overview (Card-to-Card with Unique Cent Amount)
The current payment architecture implements an automated card-to-card verification pipeline designed to avoid formal banking gateway fees during early access:

```text
User Browser
     │
     ▼ POST /api/payment/intent (Cookie Auth)
Next.js API
     │
     ├── 1. Verify JWT session (decoded.id)
     ├── 2. Generate uniqueCode: Math.floor(Math.random() * 999) + 1
     ├── 3. Calculate totalAmount: 299000 + uniqueCode (e.g. 299,482 Toman)
     ├── 4. Insert PaymentIntent (status: PENDING, expiresAt: now + 15m)
     │       └── Constraint @@unique([uniqueCode, status]) ensures no active duplicate codes
     ▼
User sends exact amount (299,482 Toman) via Mobile Bank / Card-to-Card to admin card
     │
     ▼ Bank SMS sent to Admin SIM
Admin Phone / SMS Gateway
     │
     ▼ Webhook forwarding
n8n Workflow (n8n-payment-workflow.json)
     │
     ├── 1. Regex parse: /مبلغ:\s*([\d,]+)/ -> amount = 299482
     ├── 2. Generate referenceId: 'sms-' + Date.now()
     │
     ▼ POST /api/payment/webhook (Header: Authorization: Bearer <secret>)
Next.js Webhook Handler
     │
     ├── 1. Check Bearer token against PAYMENT_WEBHOOK_SECRET
     ├── 2. Find PaymentIntent: { totalAmount: 299482, status: 'PENDING', expiresAt: > now }
     ├── 3. Transaction:
     │       ├── PaymentIntent.status = 'PAID'
     │       ├── PaymentLog.create({ action: 'CONFIRMED', metadata: { referenceId, date } })
     │       └── User.status = 'EARLY_ACCESS'
     ▼
User Browser polling /api/waitlist/status detects status == 'EARLY_ACCESS' -> Success Screen
```

### 2. Forensic Vulnerability Analysis of Payment Flow

1. **Amount-Only Matching (Severe Business Risk):**
   - The webhook matches **ONLY** on `totalAmount: parseInt(amount)` and `status: 'PENDING'`.
   - It does **NOT** match on `orderId`, `userId`, or account details.
   - If User A creates intent for 299,150 Toman and User B happens to transfer 299,150 Toman for another reason or at a nearby time, User A is credited.

2. **Denial of Service via Code Exhaustion:**
   - There are only 999 unique codes (`1` to `999`).
   - A single authenticated user can spam `/api/payment/intent` 999 times within 15 minutes.
   - Because of `@@unique([uniqueCode, status])`, once all 999 numbers are occupied by PENDING records, `retries < 10` fails and **NO OTHER USER CAN INITIATE A PAYMENT FOR 15 MINUTES**.

3. **Weak Webhook Authentication:**
   - Authenticated only with a static Bearer token (`authHeader !== 'Bearer ${process.env.PAYMENT_WEBHOOK_SECRET}'`).
   - Standard string comparison allows timing attacks.
   - No HMAC signature of the payload.
   - No timestamp header to prevent replay. An attacker intercepting an n8n request can replay it indefinitely.

4. **Missing Idempotency Guard:**
   - Webhook does not store or enforce idempotency keys. If called twice with the same reference ID, the second call returns `404 Intent not found or expired` because status became `PAID`. While this prevents double-crediting the same intent, it generates unhandled errors and has no replay audit tracking.

5. **SMS Spoofing Vulnerability:**
   - The n8n workflow parses any SMS containing `مبلغ: ...`.
   - If the receiving Android phone or SMS modem receives a spoofed SMS from a malicious number simulating the bank's format, n8n will process it and credit the account without bank cryptographic confirmation.

6. **Missing Expiry Cron / Cleanup:**
   - When a `PaymentIntent` reaches `expiresAt` (15 minutes), its status in the DB remains `PENDING` until a query filters it with `expiresAt: { gt: now }`.
   - However, the unique constraint `@@unique([uniqueCode, status])` continues to treat expired intents with status `PENDING` as occupying that `uniqueCode`, permanently reducing the pool of available unique codes until manually updated!

---

## A.4 Comprehensive Threat Model

| Asset / Vector | Threat Description | Current Control | Gap / Vulnerability | Severity | Proposed Fix (Phase B/C) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SMS Gateway Budget** | **SMS Pumping / Bombing:** Attacker uses botnet to request OTPs for thousands of numbers, draining credit. | 60s cooldown per single phone number. | Zero IP rate limiting; zero global rate limit; zero CAPTCHA. | **CRITICAL** | Redis sliding window rate limiter (IP, phone, global hourly/daily caps) + CAPTCHA challenge before SMS dispatch. |
| **OTP Verification** | **Brute-Force & Replay:** Attacker attempts 5-digit codes across challenges or re-submits captured tokens. | 3 attempts per record, immediate `verified: true`. | Attacker can request new OTP to reset attempts; bcrypt keyspace (90k) vulnerable if DB leaked. | **HIGH** | Cross-challenge failure lockout (phone + IP) + HMAC-SHA256 peppered storage. |
| **Waitlist & Identity** | **Phone Enumeration / PII Extraction:** Attacker queries API to discover if a target phone is registered. | Status requires JWT; register returns uniform message. | Database stores raw phone numbers in plaintext in `User` and `OTPVerification`. | **HIGH** | AES-256-GCM field encryption + HMAC blind index for lookups. Uniform API error timings. |
| **Session Cookie** | **Session Hijacking / Fixation:** Attacker steals JWT or exploits weak fallback secret. | `httpOnly`, `sameSite: lax`, 7-day expiry. | Fallback secret in code (`fallback-secret-for-dev`); no algorithm pinning; cookie lacks `__Host-` prefix; no revoke mechanism. | **HIGH** | Fail-closed secret requirement + `algorithms: ['HS256']` + `__Host-` cookie prefix + server-side revocation table. |
| **Payment Webhook** | **Payment Spoofing & Replay:** Attacker forges or replays n8n webhook calls to get free Early Access. | Static Bearer token in header. | Timing-unsafe check; no HMAC signature; no timestamp; no replay guard; amount-only matching. | **CRITICAL** | HMAC-SHA256 signature with timestamp window (300s) + nonce idempotency + strict timingSafeEqual. Payment disabled until refund policy finalized. |
| **Payment Pool** | **Unique Code Exhaustion DoS:** Malicious user creates 999 intents to block all checkouts. | 10 retries on collision. | No limit on active pending intents per user; expired intents keep `PENDING` status. | **HIGH** | Limit to 1 active intent per user + automatic expiration state cleanup + increase code pool/algorithm. |
| **Referral System** | **Referral Farming:** Attacker script-generates fake signups to gain +50 points per referral. | Referral recorded on OTP verification. | No self-referral check (by IP/device); no velocity check; points awarded immediately without delay. | **HIGH** | Self-referral block (IP/cookie check) + velocity rate limits + delayed credit maturity. |
| **HTTP Transport** | **Clickjacking / MIME Sniffing:** Embedding Carno in iframes or sniffing content types. | None. | Zero security headers in `next.config.ts`. `X-Powered-By` exposed. | **MEDIUM** | Comprehensive security headers (HSTS, X-Content-Type-Options, frame-ancestors 'none', Permissions-Policy, CSP). |
| **API Endpoints** | **CSRF on Route Handlers:** Attacker triggers cross-site POSTs to `/api/waitlist/*` using ambient cookies. | Server Actions have Origin check; Route Handlers do not. | Route Handlers do not check `Origin` or `Host` headers. | **MEDIUM** | Strict Origin/Host verification middleware for all `/api/*` mutation endpoints. |

---

## A.5 Conflicts Between Security Controls and Established Baseline

During the audit, the following potential conflicts were evaluated:

1. **Frozen Engine Compatibility (`public/car-frames/v1/**` and `engine/**`):**
   - **Constraint:** Zero modifications to engine code or canvas assets.
   - **Resolution:** All security controls (rate limiting, HMAC hashing, encryption, webhook verification, session cookies, headers) reside strictly in `src/app/api/**`, `src/lib/**`, and edge middleware.
   - **CSP Requirement:** Content-Security-Policy must allow `blob:` and `data:` schemes if workers or images are dynamically assembled, and must permit script execution required by React 19/Next.js without inline `unsafe-eval`.

2. **User Experience & Conversion Funnel:**
   - **Constraint:** Do not increase friction for legitimate Iranian users.
   - **Resolution:** Bot challenges (e.g. Turnstile or Altcha) must be tested for accessibility inside Iranian network space. Cooldown and lockout messages must be clear, polite, and in natural Persian.

3. **Approved Business Rules:**
   - **Constraint:** Referral points (+50) and Early Access price (299,000 Toman) must not be altered.
   - **Resolution:** Preserved exactly as specified.

---

## A.6 Verification of UI Parameters & Hardcoded Preview Values

### 1. Referral Link Base URL
- **Audit Finding:** In `WaitlistSection.tsx` (line 129) and `WaitlistPage.tsx` (line 55), the referral URL is hardcoded as:
  ```typescript
  const link = `https://carno.app/?ref=${refCode}`;
  ```
- **Evaluation:** The domain `https://carno.app` is hard-coded rather than derived from `process.env.NEXT_PUBLIC_BASE_URL` (which defaults to `http://localhost:3000`). During staging or development, sharing this link directs users to the production domain instead of the current environment.

### 2. Sample Analysis Card Hardcoded Values
- **Audit Finding:** In `SampleAnalysisSection.tsx`, the following values are hard-coded in the component:
  - Vehicle: `پژو ۲۰۷i دنده‌ای · مدل ۱۴۰۲ (سفید)`
  - Mileage: `کارکرد: ۲۸٬۰۰۰ کیلومتر · بدون رنگ`
  - Price Comparison: `حدود ۴٪ زیر میانگین بازار`
  - Opportunity Score: `۸۷ از ۱۰۰` (Gauge width: `87%`)
  - Seller Signal: `احتمال نوع فروشنده: بر اساس الگوی ثبت آگهی، احتمال فروشنده شخصی بالاست.`
- **Evaluation:** The card is prominently labeled with the attached badge:
  ```text
  [ نمونه نمایشی از خروجی Carno ] · ID: CARNO-SAMPLE-PREVIEW
  ```
  and includes an explicit footnote that actual values will be generated by the live intelligence engine upon launch. As per task rules, these illustrative values are reported here and remain untouched.

---

## A.7 Dependency Vulnerability Audit Summary (`npm audit`)

An official registry audit was executed via `npm audit --registry=https://registry.npmjs.org`:

```text
5 high severity vulnerabilities found in development tooling:
- braces (<3.0.3) vulnerable to stack exhaustion denial of service
  └── micromatch
      └── fast-glob
          └── @next/eslint-plugin-next
              └── eslint-config-next
```

- **Runtime Impact:** **Zero.** These vulnerabilities reside exclusively in `eslint-config-next` and related devDependencies used during build/linting time. No vulnerable code is shipped to client browsers or executed in the production server runtime.

---

## A.8 Phase A Completion & Boundary Verification

```bash
git diff --stat -- src/features/carno-experience/engine public/car-frames
# Output: (empty — 0 files changed)
```

The protected 120-frame vehicle engine and all car assets remain strictly untouched.

---

> [!IMPORTANT]
> **PHASE A IS COMPLETE.**  
> In accordance with the execution protocol, all work is now **STOPPED** awaiting Human Review Gate 1.  
> Do NOT proceed to Phase B until explicit human approval is received.
