# Carno — MeliPayamak SMS / OTP Integration Specification & Audit

> **Project:** Carno / کارنو  
> **Repository:** `radifo-khodro-landing`  
> **Branch:** `conversion-redesign`  
> **Stage:** Pre-Implementation Read-Only Audit & Architectural Specification  
> **Document Purpose:** Single source of truth for connecting and hardening Carno's OTP authentication to the official MeliPayamak SMS service.

---

## 1. Provider & Official Documentation Consulted

| Reference | Source / URL | Key Information Extracted |
| :--- | :--- | :--- |
| **MeliPayamak Portal** | `https://www.melipayamak.com/` | Web service architecture, Service Lines vs Advertising Lines, Pattern messaging mechanism |
| **Official Node.js Repository** | `https://github.com/Melipayamak/melipayamak-node` | `sendByBaseNumber(text, to, bodyId)` signature, parameter encoding, and REST endpoint wrapper |
| **Official REST API (BaseServiceNumber)** | `https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber` | Endpoint for high-priority OTP/service messages delivered via service line (bypasses promotional SMS blocks). Uses `application/x-www-form-urlencoded` parameters. |
| **Official REST API (SendSMS)** | `https://rest.payamak-panel.com/api/SendSMS/SendSMS` | General SMS sending (subject to advertising line filters and recipient promotional SMS blocks) |
| **Response & Error Codes Contract** | MeliPayamak WebService Spec | `RetStatus` (1 = success, < 0 = error), `Value` (recId on success; error codes: 0 = bad credentials, -1 = unauthorized method, 2 = low balance, 6 = system update) |

---

## 2. Audit of Existing Implementation

### 2.1 Existing Code Inventory

| File Path | Role | Current Status & Audit Findings |
| :--- | :--- | :--- |
| [src/lib/sms.ts](file:///Users/mahdi/Documents/DivarLanding/src/lib/sms.ts) | SMS Transport utility | **OUTDATED & FLAWED:** Uses `SendSMS/SendSMS` (advertising line not delivered to recipients who have blocked promotional SMS). Hardcodes `کد تایید شما در کارنو...`. Logs full phone and SMS text to console. Returns undefined on missing credentials without proper typed status. |
| [src/app/actions/auth.ts](file:///Users/mahdi/Documents/DivarLanding/src/app/actions/auth.ts) | Legacy Server Action | **LEGACY / DEFECTIVE:** Uses `BaseServiceNumber` with hardcoded fake `bodyId: 1234` and JSON body. Uses weak `Math.random()`. Logs plaintext OTP to console (`console.log('[DEV MODE] OTP Code...')`). **Critically misses setting the `httpOnly` JWT session cookie**, breaking downstream authenticated APIs. |
| [src/app/api/waitlist/register/route.ts](file:///Users/mahdi/Documents/DivarLanding/src/app/api/waitlist/register/route.ts) | OTP Challenge Initiation | **ACTIVE PATH (REUSED):** Validates phone regex (`^09\d{9}$`). Has 1-minute rate limiting per phone. Generates 4-digit code via `Math.random()`. Hashes OTP with bcrypt. Expires in 5 minutes. Calls `sendOTP` from `sms.ts`. |
| [src/app/api/waitlist/verify/route.ts](file:///Users/mahdi/Documents/DivarLanding/src/app/api/waitlist/verify/route.ts) | OTP Challenge Verification | **ACTIVE PATH (REUSED):** Checks attempt count (`attempts >= 3` -> 429). Compares bcrypt hash. Increments attempts on failure. Sets `verified: true`. Creates/finds User and WaitlistEntry. **Sets secure `httpOnly` JWT cookie (`token`) valid for 7 days**. Tracks referrals with +50 priority score. |
| [prisma/schema.prisma](file:///Users/mahdi/Documents/DivarLanding/prisma/schema.prisma) | Data Persistence | Model `OTPVerification` stores `phone`, `codeHash`, `expiresAt`, `attempts`, `verified`, and index `[phone, verified]`. Models `User` and `WaitlistEntry` handle session identity. |
| [src/features/carno-experience/sections/WaitlistSection.tsx](file:///Users/mahdi/Documents/DivarLanding/src/features/carno-experience/sections/WaitlistSection.tsx) | Customer-facing UX | Consumes `/api/waitlist/register` and `/api/waitlist/verify`. Has phone input step, 6-char OTP step, and verified rank/referral display. |

---

## 3. Detailed Comparison: Official Provider Contract vs Current Code

| Dimension | MeliPayamak Official Standard | Current Carno Code | Required Action |
| :--- | :--- | :--- | :--- |
| **Send Method for OTP** | `BaseServiceNumber` (Pattern/Service line). Instant delivery, delivers to recipients who block promotional SMS. | In `sms.ts`: `SendSMS/SendSMS` (Advertising line). In `auth.ts`: `BaseServiceNumber` with fake `bodyId: 1234`. | Unify all SMS calls through a single robust `SmsProvider` interface using `BaseServiceNumber` as primary, with configured `bodyId`. |
| **Content-Type & Encoding** | `application/x-www-form-urlencoded` with form-encoded parameters. | `auth.ts` sends `application/json` with `JSON.stringify()`. | Use `application/x-www-form-urlencoded` with `URLSearchParams`. Do not use `JSON.stringify()` for `BaseServiceNumber`. |
| **Endpoint URL** | `https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber` | Scattered in `sms.ts` and `auth.ts`. | Consolidate inside `src/lib/sms/melipayamak.ts`. |
| **Request Payload Fields** | Form-encoded: `username`, `password`, `text`, `to`, `bodyId` (`text` is string with args separated by `;`). `from` is NOT required. | `auth.ts` sends JSON `{ text: code, bodyId: 1234 }`. `sms.ts` sends full Persian text. | Standardize payload format: URL-encoded `text` formatted as `${code}` (or `${code};arg2`). Remove `from` requirement for OTP. |
| **Credentials** | `MELIPAYAMAK_USERNAME`, `MELIPAYAMAK_PASSWORD` (or API Key), `MELIPAYAMAK_BODY_ID`. `MELIPAYAMAK_FROM` is NOT needed for BaseServiceNumber. | `MELIPAYAMAK_FROM` present, but `MELIPAYAMAK_BODY_ID` is missing from `.env` and `.env.example`. | Add `MELIPAYAMAK_BODY_ID` to `.env.example`. Make `MELIPAYAMAK_FROM` optional (not a dependency for BaseServiceNumber OTP). |
| **OTP Generation** | Cryptographically secure random integer. | `Math.floor(1000 + Math.random() * 9000)` (Weak pseudo-random). | Replace with Node.js `crypto.randomInt(10000, 100000)` (5-digit secure OTP). |
| **Phone Normalization** | Provider requires standard 11-digit Iranian mobile format (e.g. `09123456789`). | Accepts only exact `^09\d{9}$` English digits; rejects Persian digits (`۰-۹`) and `+98` formats with an error. | Implement phone normalization utility: trim, convert Persian/Arabic digits, strip `+98` / `0098`, and enforce canonical `09xxxxxxxxx`. |
| **Logging & Security** | Plaintext OTPs and API secrets must NEVER be logged. | `console.log` logs plaintext OTPs in `auth.ts` and `sms.ts`. | Strip all plaintext OTP logging. Use structured events with masked phone numbers (`0912***4567`). |
| **Response Validation** | Inspect `RetStatus` and `Value` (recId vs negative error code). | Checks only `response.json()` without verifying `RetStatus === 1`. | Implement strict provider response parsing with mapping to user-safe error messages. |

---

## 4. Architectural Design for Production Hardening

### 4.1 Architecture Overview

```text
User Browser (WaitlistSection)
         │
         ▼ POST /api/waitlist/register
Next.js Route Handler
         │
         ├── 1. Normalize Phone (convert Persian digits, sanitize +98)
         ├── 2. Rate Limit Check (IP + Phone cooldown: 1 request / 60s)
         ├── 3. Cryptographically Secure OTP Generation (crypto.randomInt)
         ├── 4. Hash OTP with bcrypt (10 rounds)
         ├── 5. Invalidate prior pending OTPs & save to PostgreSQL (Prisma)
         │
         ▼ SmsService.sendOtp({ phone, code })
SmsProvider Abstraction (src/lib/sms/)
         │
         ├── Production: MeliPayamakProvider (BaseServiceNumber)
         │     └── Form-urlencoded POST: username, password, to, bodyId, text
         └── Local/Dev: DevMockSmsProvider (enabled ONLY when MeliPayamak credentials unset & NODE_ENV !== 'production')
         │
         ▼ HTTP POST (application/x-www-form-urlencoded) https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber
MeliPayamak Gateway (Service Line)
         │
         ▼ SMS Delivery
User Handset
```

### 4.2 Verification Flow (Route Handler)

```text
User enters OTP in Browser
         │
         ▼ POST /api/waitlist/verify { phone, otp, referredByCode, source }
Next.js Route Handler
         │
         ├── 1. Normalize Phone
         ├── 2. Find active OTP challenge (expiresAt > now, verified == false)
         ├── 3. Max Attempts Check (attempts >= 3 -> 429 Too Many Requests)
         ├── 4. Constant-Time bcrypt.compare(otp, challenge.codeHash)
         │       └── If invalid: increment attempts, return 400
         ├── 5. Mark challenge as verified: true (Atomic replay prevention)
         ├── 6. Database Transaction:
         │       ├── Find or create User (phoneVerified: true)
         │       ├── Process Referral (+50 priority score to referrer)
         │       └── Create WaitlistEntry (nanoid referralCode)
         ├── 7. Sign JWT (id, phone) with JWT_SECRET
         └── 8. Set httpOnly, secure-in-prod, SameSite=Lax cookie 'token'
         │
         ▼ HTTP 200 { success: true }
Browser receives session cookie & displays real queue rank
```

---

## 5. Environment Variables & Credentials

### 5.1 Required Environment Variables

```bash
# MeliPayamak SMS Gateway (BaseServiceNumber / OTP)
MELIPAYAMAK_USERNAME=your_melipayamak_username_or_apikey   # Required: Username or API Key
MELIPAYAMAK_PASSWORD=your_melipayamak_password_or_apikey   # Required: Password or API Key
MELIPAYAMAK_BODY_ID=123456                                 # Required: Approved Pattern / Template ID in panel
MELIPAYAMAK_FROM=5000...                                   # Optional: Only needed if standard SendSMS is used elsewhere (NOT required for BaseServiceNumber)

# Development Mode Control
SMS_DEV_MODE=false                                        # Optional: When true (dev only), logs masked preview without calling gateway
```

### 5.2 Current Environment Status in `.env`
- `MELIPAYAMAK_USERNAME`: **EMPTY**
- `MELIPAYAMAK_PASSWORD`: **EMPTY**
- `MELIPAYAMAK_BODY_ID`: **NOT_FOUND**
- `MELIPAYAMAK_FROM`: **EMPTY (Not required for BaseServiceNumber)**

> [!IMPORTANT]
> **Real SMS Test Status:**  
> A live SMS end-to-end test cannot be executed until valid MeliPayamak credentials and an approved `MELIPAYAMAK_BODY_ID` are configured in `.env`. The system is designed to fall back safely to a mock logger in local development without crashing the application.

---

## 6. Security & Hardening Controls

1. **Zero Secret Exposure:** Credentials are accessed exclusively in server-side Node.js runtime. No `NEXT_PUBLIC_` prefixes.
2. **Zero Plaintext OTP Storage:** All OTPs are hashed using bcrypt with 10 salt rounds prior to persistence.
3. **No OTP in Responses or Client Logs:** Responses return `{ success: true, message: '...' }` only. Plaintext OTP is never returned to the browser or logged in stdout.
4. **Brute-Force & Attempt Limitation:** Maximum of 3 failed verification attempts per OTP challenge before automatic lockout.
5. **Cooldown Rate Limiting:** 60-second minimum cooldown between resend requests per phone number.
6. **Replay Prevention:** Challenge is atomically marked `verified: true` upon successful validation.
7. **Canonical Phone Normalization:** Prevents account duplication by converting `+98912...`, `۰۹۱۲...`, and `0912...` to canonical `0912...`.
8. **Request Body Encoding:** Uses `application/x-www-form-urlencoded` conforming to official MeliPayamak REST examples.
9. **Zero Engine Modifications:** Protected engine (`src/features/carno-experience/engine/**`) and car assets (`public/car-frames/**`) remain untouched.

---

## 7. Deliverables & Files to Be Modified in Implementation Phase

1. [src/lib/sms/types.ts](file:///Users/mahdi/Documents/DivarLanding/src/lib/sms/types.ts) *(NEW)*: Typed interfaces for `SmsProvider`, `SendOtpInput`, `SendOtpResult`.
2. [src/lib/sms/phone.ts](file:///Users/mahdi/Documents/DivarLanding/src/lib/sms/phone.ts) *(NEW)*: Iranian phone normalization utility (Arabic/Persian digits, +98 prefix, regex validation).
3. [src/lib/sms/melipayamak.ts](file:///Users/mahdi/Documents/DivarLanding/src/lib/sms/melipayamak.ts) *(NEW)*: Official `BaseServiceNumber` implementation with `application/x-www-form-urlencoded` encoding, typed error handling, and response validation.
4. [src/lib/sms/index.ts](file:///Users/mahdi/Documents/DivarLanding/src/lib/sms/index.ts) *(NEW)*: Unified SMS service entrypoint with dev fallback.
5. [src/lib/sms.ts](file:///Users/mahdi/Documents/DivarLanding/src/lib/sms.ts) *(MODIFY)*: Re-export or forward to new modular SMS service to maintain backwards compatibility.
6. [src/app/api/waitlist/register/route.ts](file:///Users/mahdi/Documents/DivarLanding/src/app/api/waitlist/register/route.ts) *(MODIFY)*: Use cryptographically secure `crypto.randomInt`, phone normalization, and hardened rate limiting.
7. [src/app/api/waitlist/verify/route.ts](file:///Users/mahdi/Documents/DivarLanding/src/app/api/waitlist/verify/route.ts) *(MODIFY)*: Use phone normalization, transaction safety for concurrent signups, and keep JWT cookie.
8. [.env.example](file:///Users/mahdi/Documents/DivarLanding/.env.example) *(MODIFY)*: Add `MELIPAYAMAK_BODY_ID=` and document provider keys clearly.

