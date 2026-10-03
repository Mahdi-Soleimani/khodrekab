# CARNO PRODUCTION CONVERSION EXPERIENCE SPECIFICATION
## Phase B Master Experience & Design Specification (Revised)

> Document: `CARNO_CONVERSION_EXPERIENCE_SPEC.md`  
> Project: Carno / کارنو  
> Branch: `conversion-redesign`  
> Phase: B (Specification Stage — Revised based on Gate 2 Review Feedback)  
> Gate: Awaiting Human Review Gate 2 Re-evaluation  
> Implementation Policy: Phase A (Approved) → Phase B (Current) → STOP → Gate 2 Approval → Phase C  

---

## 0. SPECIFICATION GOVERNING PRINCIPLES

1. **Non-Negotiable Car Engine Protection:** The existing 120-frame WebP vehicle engine and production assets are frozen. All conversion, copy, layout, and trust layers happen **around** the car without touching engine or asset files.
2. **Strict Backend Reuse (No Silent Architectural Rewrites):** Existing backend capabilities (Prisma, PostgreSQL, MeliPayamak SMS, JWT auth, card-to-card intent flow) will be reused as-is.
3. **Truthful Data Only (Anti-Dark Pattern):** Zero fabricated prices, zero fabricated opportunity scores, zero fabricated rankings, zero artificial offsets, zero fake countdowns, and zero fake recent users.
4. **Test-Only Payment:** Payments remain strictly disabled/test-mode until the refund and cancellation policy is finalized and approved.

---

## 1. AUTHENTICATION ARCHITECTURE REUSE PLAN

### 1.1 Flow Selection & Rationale
The audit identified two parallel auth implementations:
- Option A: Server Actions (`src/app/actions/auth.ts`)
- Option B: Next.js Route Handlers (`/api/waitlist/register` & `/api/waitlist/verify`)

**Specification Decision:**  
The conversion experience on the landing page will **reuse the existing Route Handler flow (`/api/waitlist/register` and `/api/waitlist/verify`)**.

**Technical Rationale:**
1. **JWT Session Cookie Issuance:** `/api/waitlist/verify` securely signs a 7-day JWT token and sets the `httpOnly`, `SameSite=Lax` cookie named `token` (`response.cookies.set('token', token, ...)`).
2. **Dependency Alignment:** Both `/api/waitlist/status` (which supplies the real waitlist queue rank) and `/api/payment/intent` (which creates the payment intent) **strictly read and verify this exact `token` cookie**. The Server Action `verifyOtpAction` currently does NOT set this cookie.
3. **Rate Limiting & Expiry:** `/api/waitlist/register` already enforces a 1-minute rate limit per phone number and a 5-minute OTP expiry in the database.
4. **Referral Handling:** `/api/waitlist/verify` already captures `referredByCode` from the URL, creates the `Referral` record, and increments the inviter's `priorityScore` by +50.
5. **No Architectural Rewrite:** Reusing `/api/waitlist/*` preserves the existing database schema, existing verification logic, and existing cookie contract without inventing a new auth mechanism.

### 1.2 Preservation of the Cookie Contract
- The client-side registration form will send requests to `/api/waitlist/register` and `/api/waitlist/verify`.
- The browser automatically receives and stores the `httpOnly` `token` cookie.
- Following verification, the client immediately queries `/api/waitlist/status` using the active session cookie to retrieve the user's real queue position and personal referral link.

---

## 2. WAITLIST RANK SPECIFICATION (REAL BACKEND LOGIC ONLY)

### 2.1 Elimination of Artificial Offset
- **Discrepancy Addressed:** The audit revealed `const baseOffset = parseInt(process.env.WAITLIST_BASE_OFFSET || '300', 10);` in `src/app/actions/auth.ts`, which artificially inflated user position by 300.
- **Specification Rule:** The frontend will **strictly use real backend ranking** provided by `/api/waitlist/status`:
  ```typescript
  // Actual backend calculation in /api/waitlist/status/route.ts:
  const usersAhead = await prisma.waitlistEntry.count({
    where: {
      OR: [
        { priorityScore: { gt: user.waitlistEntry.priorityScore } },
        {
          priorityScore: user.waitlistEntry.priorityScore,
          joinedAt: { lt: user.waitlistEntry.joinedAt }
        }
      ]
    }
  });
  let currentRank = usersAhead + 1;
  ```
- **Display Output:**
  ```text
  جایگاه فعلی تو در صف دسترسی اولیه:
  # [currentRank]
  ```
- **Truthful Early Cohort Messaging:**
  If the queue is small (e.g. rank #1 to #20), the UI will honestly state:
  > **در حال تشکیل اولین گروه کاربران Carno**
  No fake numbers, no artificial offsets, and no fabricated recent users list.

---

## 3. REFERRAL BUSINESS LOGIC & DISCREPANCY RECORD

### 3.1 Documented Discrepancy
- **Current Active Backend (`/api/waitlist/verify/route.ts`):** Confirmed invited signup increments inviter's `priorityScore` by **+50**.
- **Historical Requirement Mentioned:** +50 for invited signup, and **+200 for Early Access conversion**.
- **Backend Reality:** The +200 Early Access conversion score increment is **not currently implemented** in `/api/payment/webhook/route.ts`.

### 3.2 Policy for Redesign
- **Rule:** Do **NOT** silently alter the backend business logic or implement unauthorized database scoring changes during frontend conversion redesign.
- **Customer-Facing Copy:** Reflects only the confirmed, active backend capability:
  > **با دعوت از دوستان، اولویت دسترسی خودت را بهتر کن.**  
  > هر دعوت موفق = ۵۰ امتیاز ارتقای اولویت در لیست انتظار.
- **Human Decision Required:** If the product owner wishes to activate the +200 Early Access conversion score in the backend, that will be treated as an explicit, separate backend task requiring explicit authorization.

---

## 4. PAYMENT IMPLEMENTATION SPECIFICATION (STRICT TEST-ONLY MODE)

### 4.1 Test-Only / Disabled Status
In accordance with Section 18 of `CARNO_PROMPT.md`:
- **Live Payments:** **STRICTLY DISABLED**.
- **No Real Transactions:** No real banking credentials or live merchant cards will be exposed or charged.
- **Pre-Condition for Live Activation:** Live payment activation is blocked until:
  1. The product owner finalizes the official **Refund & Cancellation Policy** (currently PENDING).
  2. The product owner explicitly authorizes live payment activation in writing.

### 4.2 Interactive Test-Mode UX
The UX will be completely implemented to allow stakeholders to review and experience the conversion flow:
- The Early Access Pass will feature the primary CTA:
  ```text
  [ فعال‌سازی دسترسی نسل اول ]
  ```
- Triggering the action will display the card-to-card verification modal in **Test / Preview Mode**:
  - Displays a clear, permanent banner:
    > **حالت آزمایشی (پیش‌نمایش)**  
    > درگاه پرداخت به دلیل نهایی‌سازی قوانین بازگشت وجه در حالت آزمایشی است. هیچ وجهی از شما کسر نخواهد شد.
  - Demonstrates the unique fractional amount mechanism (e.g. ۲۹۹,۱۲۴ تومان) and 15-minute verification countdown.
  - Includes a test action button allowing reviewers to simulate a successful payment and view the resulting state transition without processing real money.

---

## 5. SAMPLE ANALYSIS SECTION (STRUCTURAL PLACEHOLDER ONLY)

### 5.1 Real Data Dependency: PENDING
Because real sanitized vehicle analysis data is currently unavailable:
- **NO fabricated prices** (e.g. 620M, 680M, 850M) will be presented as real Carno calculations.
- **NO fabricated opportunity scores** (e.g. 87/100, 92/100) will be presented as real output.
- **NO fabricated seller signals** will be manufactured.

### 5.2 Mandatory Attached Disclaimer
The card must permanently embed this attached badge inside the card container:
```text
┌──────────────────────────────────────────────────────────────────┐
│  نمونه تحلیل Carno                 [ نمونه نمایشی از خروجی Carno ] │
└──────────────────────────────────────────────────────────────────┘
```

### 5.3 Complete Card Structure (With Structural Placeholders)
```text
┌──────────────────────────────────────────────────────────────────┐
│  [ نمونه نمایشی از خروجی Carno ]                                  │
│  تحلیل هوشمند آگهی خودرو                                         │
├────────────────────────────────┬─────────────────────────────────┤
│  قیمت اعلامی در آگهی           │  تخمین قیمت منصفانه بازار       │
│  [ قیمت نمونه نمایشی ]           │  [ برآورد نمونه نمایشی ]        │
├────────────────────────────────┴─────────────────────────────────┤
│  امتیاز فرصت خرید Carno                                          │
│  [ -- / ۱۰۰ ]  (ارزیابی اولیه بر اساس تحلیل شاخص‌های بازار)      │
├──────────────────────────────────────────────────────────────────┤
│  نشانه‌های تحلیلی آگهی و فروشنده:                                │
│  • نشانه‌های نوع فروشنده: ارزیابی احتمال فروشنده شخصی بر اساس     │
│    الگوی انتشار و متن آگهی                                       │
│  • همخوانی کارکرد و استهلاک: مقایسه کارکرد با میانگین بازار      │
│  • سطح قیمت‌گذاری: سنجش جایگاه قیمت نسبت به بازه معاملات منصفانه │
├──────────────────────────────────────────────────────────────────┤
│  جمع‌بندی تحلیلی Carno:                                          │
│  «این بخش خلاصه وضعیت خودرو و ارزش بررسی حضوری آن را بر اساس     │
│  سیگنال‌های موجود در آگهی ارائه می‌دهد.»                        │
└──────────────────────────────────────────────────────────────────┘
```
This fulfills the structural and psychological requirements without fabricating numerical product claims.

---

## 6. HERO & FROZEN VEHICLE EXPERIENCE PRESERVATION

### 6.1 Strict Engine & Asset Boundary
The following paths are **STRICTLY PROTECTED AND UNCHANGED**:
- `public/car-frames/v1/**` (all 120 desktop & 120 mobile WebP frames, manifest.json)
- `src/features/carno-experience/engine/**` (all 14 loader, cache, and renderer modules)
- Frame count: **120 frames**
- Rotation progression: **360° scroll-scrubbed rotation**
- Frame mapping: **Linear scroll mapping via FrameController**

### 6.2 Editable Experience Scope
All Hero copy updates and layout adjustments occur strictly within the editable experience layer:
- `src/features/carno-experience/sections/CarStoryOverlay.tsx`
- `src/features/carno-experience/sections/CTASection.tsx`
- `src/features/carno-experience/sections/HeroSection.tsx`

### 6.3 Approved 4-Phase Hero Narrative Copy

| Phase | Viewpoint | Progress | Approved Primary Headline | Approved Supporting Message |
|---|---|---|---|---|
| **Phase 1: Front / First Impression** | Front 3/4 | `0.00 - 0.25` | **این خودرو واقعاً چقدر می‌ارزد؟** | Carno قیمت بازار را بررسی می‌کند تا بفهمی یک آگهی گران است، منصفانه است یا می‌تواند فرصت خرید باشد. |
| **Phase 2: Side / Opportunity** | Side Profile | `0.25 - 0.50` | **فرصت‌های زیر قیمت بازار را قبل از بقیه پیدا کن.** | از میان گزینه‌های بازار، خودروهایی را که ارزش بررسی بیشتری دارند برایت مشخص می‌کنیم. |
| **Phase 3: Rear / Hidden Signals** | Rear 3/4 | `0.50 - 0.75` | **قبل از تماس، چیزی را ببین که در آگهی دیده نمی‌شود.** | نشانه‌های مهم آگهی و فروشنده را کنار هم ببین تا وقتت را برای گزینه‌ی اشتباه نگذاری. |
| **Phase 4: Return / Decision** | Return to Front | `0.75 - 1.00` | **ماشین بعدی‌ات را با عدد انتخاب کن، نه با حدس.** | هر گزینه می‌تواند یک امتیاز فرصت خرید داشته باشد. ثبت‌نام اولیه رایگان است. |

---

## 7. PRE-LAUNCH TRANSPARENCY & TRUTHFUL URGENCY

### 7.1 Persistent Pre-Launch Status Message
Positioned near the primary CTA block:
> **در حال آماده‌سازی · لانچ حدود یک ماه دیگر**

### 7.2 Prohibited Conversion Mechanics
- ❌ NO artificial countdown timers (e.g. "Only 3 days left").
- ❌ NO fabricated scarcity claims (e.g. "Only 12 spots left").
- ❌ NO fabricated user activity tickers (e.g. "User 0912***4512 joined just now").
- ❌ NO unverified speed claims (e.g. "ثبت‌نام در کمتر از ۱۰ ثانیه").
- ❌ NO fake social proof or fabricated customer logos.

---

## 8. MASTER PAGE ARCHITECTURE & SEQUENTIAL FLOW

```text
┌─────────────────────────────────────────────────────────────────┐
│ 1. HEADER / NAVIGATION                                          │
│    Logo: کارنو (Carno) · Link: نسخه اول · CTA: دریافت دسترسی اولیه│
├─────────────────────────────────────────────────────────────────┤
│ 2. CINEMATIC HERO (500vh Scroll Orchestration)                  │
│    • Protagonist: 120-Frame 3D Vehicle Turntable (FROZEN Engine)│
│    • Status: در حال آماده‌سازی · لانچ حدود یک ماه دیگر          │
│    • 4 Narrative Phases (این خودرو واقعاً چقدر می‌ارزد؟ ...)     │
│    • CTA: دریافت دسترسی اولیه (اسکرول به فرم ثبت‌نام)           │
│    • Link: نمونه تحلیل را ببین ↓                                │
│    • Note: ثبت‌نام اولیه رایگان · فقط شماره موبایل             │
├─────────────────────────────────────────────────────────────────┤
│ 3. PROBLEM RECOGNITION (بزرگترین اشتباه هنگام خرید خودرو)        │
│    • ظاهر سالم ≠ معامله خوب                                     │
│    • قیمت آگهی ≠ ارزش واقعی                                     │
│    • حدس و گمان ≠ تصمیم عددی                                    │
├─────────────────────────────────────────────────────────────────┤
│ 4. SAMPLE ANALYSIS SECTION (نمونه تحلیل Carno)                  │
│    • Attached Badge: [ نمونه نمایشی از خروجی Carno ]            │
│    • Structural Card: قیمت اعلامی vs تخمین منصفانه              │
│    • شاخص فرصت خرید + نشانه‌های آگهی و فروشنده                  │
├─────────────────────────────────────────────────────────────────┤
│ 5. THREE-STEP PRODUCT EXPLANATION                               │
│    ۱. نیازت را مشخص کن                                          │
│    ۲. Carno بازار را بررسی می‌کند                               │
│    ۳. گزینه‌هایی را ببین که ارزش بررسی دارند                    │
├─────────────────────────────────────────────────────────────────┤
│ 6. TRUST & TRANSPARENCY LAYER                                   │
│    • سازندگان: تیم جی‌هاب (Jeyhub)                               │
│    • وضعیت: فاز آماده‌سازی لانچ (حدود یک ماه دیگر)              │
│    • حریم خصوصی: استفاده از شماره صرفاً برای احراز هویت پیامکی  │
│    • ارتباط مستقیم با تیم                                        │
├─────────────────────────────────────────────────────────────────┤
│ 7. WAITLIST REGISTRATION (Real Route Handler OTP Flow)          │
│    • Headline: برای دریافت دسترسی اولیه، جایگاهت را ثبت کن.      │
│    • Input: شماره موبایل (۰۹...)                                │
│    • OTP: دریافت و تایید کد پیامکی                             │
│    • Session: تنظیم کوکی httpOnly (token)                       │
├─────────────────────────────────────────────────────────────────┤
│ 8. POST-REGISTRATION PERSONAL STATUS                            │
│    • پیام: ثبت‌نامت با موفقیت انجام شد.                          │
│    • جایگاه واقعی: # [REAL_RANK] در صف دسترسی اولیه             │
│    • وضعیت صادقانه: در حال تشکیل اولین گروه کاربران Carno       │
│    • لینک اختصاصی دعوت دوستان (+۵۰ امتیاز برای هر دعوت موفق)    │
├─────────────────────────────────────────────────────────────────┤
│ 9. EARLY ACCESS PASS (نسخه اول کارنو)                           │
│    • Headline: می‌خواهی جزو نسل اول Carno باشی؟                 │
│    • Price: ۲۹۹٬۰۰۰ تومان                                       │
│    • مزایا: اولویت بدون نوبت، نشان نسل اول، ارتباط با سازندگان  │
│    • CTA: فعال‌سازی دسترسی نسل اول                              │
│    • وضعیت: حالت آزمایشی / پیش‌نمایش (بدون تراکنش واقعی)        │
├─────────────────────────────────────────────────────────────────┤
│ 10. FAQ & FOOTER                                                │
│     • سوالات متداول درباره نحوه کار، زمان عرضه و قیمت‌گذاری      │
│     • فوتر برند، حقوق معنوی جی‌هاب و راه‌های ارتباطی            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. CLAIM VERIFICATION REVIEW TABLE

| Statement / Claim | Classification | Status & Mitigation |
|---|---|---|
| **"قیمت واقعی بازار"** | **CONFIRMED** | Product core capability to estimate fair market value based on market data. |
| **"فرصت‌های زیر قیمت بازار"** | **CONFIRMED** | Algorithmic filtering of listings priced below fair market valuation. |
| **"نشانه‌های آگهی و فروشنده"** | **CONFIRMED** | Probabilistic analysis of listing characteristics. Always uses probabilistic Persian phrasing. |
| **"امتیاز فرصت خرید"** | **CONFIRMED** | Supported opportunity metric (out of 100). |
| **"با عدد، نه با حدس"** | **CONFIRMED** | Brand positioning concept. |
| **"در حال آماده‌سازی · لانچ حدود یک ماه دیگر"** | **CONFIRMED** | Truthful pre-launch status. |
| **"ثبت‌نام اولیه رایگان · فقط شماره موبایل"** | **CONFIRMED** | Matches actual zero-cost waitlist registration flow. |
| **"۲۹۹٬۰۰۰ تومان عضویت نسل اول"** | **CONFIRMED** | Matches approved pricing in database schema. |
| **Reusing `/api/waitlist/*` for Auth** | **CONFIRMED** | Verified in codebase; correctly sets `token` JWT cookie. |
| **Real Queue Position (No Offset)** | **CONFIRMED** | Explicitly specifies `usersAhead + 1` from `/api/waitlist/status`. |
| **+50 Invited Signup Referral Score** | **CONFIRMED** | Verified in `/api/waitlist/verify/route.ts`. |
| **+200 Early Access Conversion Referral Score** | **DISCREPANCY / PENDING** | Not currently implemented in webhook; marked for explicit human confirmation. |
| **Sample Vehicle Output Figures** | **REQUIRES HUMAN INPUT** | Live sanitized data pending; card uses structural placeholders only. |
| **Maker Names / Team Photos** | **REQUIRES HUMAN INPUT** | Specific individual names pending; uses "تیم جی‌هاب" until provided. |
| **Refund / Cancellation Policy** | **REQUIRES HUMAN INPUT** | Must be finalized before live payment; payment remains in test-only mode. |

---

## Phase B Completion & Gate 2 Stop Condition

Phase B specification revision is **COMPLETE**.

In strict compliance with **Section 43 of CARNO_PROMPT.md**:
- **STOPPING EXECUTION IMMEDIATELY.**
- **NO code implementation will occur without explicit Human Review Gate 2 approval.**
