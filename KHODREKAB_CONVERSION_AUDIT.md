# CARNO PRODUCTION CONVERSION AUDIT
## Phase A Read-Only Architectural & Experience Audit

> Document: `CARNO_CONVERSION_AUDIT.md`  
> Project: Carno / کارنو  
> Repository: `radifo-khodro-landing`  
> Branch: `conversion-redesign`  
> Date: October 2026  
> Status: PHASE A COMPLETE — AWAITING HUMAN REVIEW GATE 1  

---

## EXECUTIVE SUMMARY

This audit performs an exhaustive, read-only technical inspection of the Carno automotive intelligence landing codebase. 

The primary findings are:
1. **The 3D Vehicle Engine is Approved & Fully Operational:** The 120-frame WebP rotation engine (`/car-frames/v1/`) running via Canvas, `ImageBitmap`, `BitmapCache`, `LoadQueue`, and `CanvasRenderer` is functioning smoothly and remains **strictly protected**.
2. **Severe Narrative & Value Disconnect on the Live Landing Page:** The current root page (`src/app/page.tsx` rendering `ProductLandingPage.tsx`) presents misaligned placeholder copy:
   - An electric supercar concept in `CarStoryOverlay.tsx` ("کشف زیبایی", "قدرت الکتریکی خالص", "نسل جدید خودروهای الکتریکی") instead of the real product positioning ("دستیار هوشمند بازار خودرو", "با عدد، نه با حدس").
   - A technical engineering showcase in `TrustSection.tsx` ("۱۲۰ فریم سینمایی", "تعاملی بدون ویدیو", "بهینه شده برای موبایل") instead of human/product trust.
   - An unstyled, English lead-capture form in `LeadCaptureSection.tsx` ("Ready to experience the future?") that simulates a submission locally and completely bypasses the real waitlist.
3. **Real Production Backend Exists but is Disconnected:** A robust PostgreSQL/Prisma backend with real SMS OTP verification, waitlist priority queues, referral ranking, and n8n card-to-card payment intent processing exists in the codebase (`/api/waitlist/*`, `/api/payment/*`, `src/app/actions/auth.ts`, `WaitlistForm.tsx`), but was left completely unmounted on the main customer-facing route.
4. **Sample Analysis Data is PENDING:** No real sanitized vehicle intelligence data exists in the repository; all prior figures (e.g. 850M vs 780M, 92/100, 85/100) are hardcoded demo mocks.
5. **Maker Identity is Incomplete:** Only "تیم جی‌هاب" (Jeyhub) and a logo image are present; individual maker/team identities and contact channels are pending human input.
6. **Payment is Test-Only:** Payment uses mock card data and lacks an approved refund/cancellation policy; it must remain disabled or in test-only mode.

---

## A. CURRENT PAGE STRUCTURE

### 1. Route Structure
| Route | File Path | Current Status | Description |
|---|---|---|---|
| `/` | `src/app/page.tsx` | Active Root | Renders `ProductLandingPage` from `@/features/carno-experience/pages/ProductLandingPage`. |
| `/waitlist` | `src/app/waitlist/page.tsx` | Secondary Page | User waitlist dashboard showing rank, referral code link, and early access upgrade card. |
| `/payment` | `src/app/payment/page.tsx` | Secondary Page | Card-to-card payment screen with 15-minute countdown, unique fractional amounts, and polling. |
| `/success` | `src/app/success/` | Empty Directory | Contains no page component. |
| `/api/waitlist/register` | `src/app/api/waitlist/register/route.ts` | API Route | Issues 4-digit SMS OTP, creates OTP record in DB. |
| `/api/waitlist/verify` | `src/app/api/waitlist/verify/route.ts` | API Route | Validates OTP, creates User & WaitlistEntry, increments inviter score (+50), sets JWT cookie. |
| `/api/waitlist/status` | `src/app/api/waitlist/status/route.ts` | API Route | Authenticates via JWT cookie, calculates exact rank in waitlist, returns user status & refCode. |
| `/api/payment/intent` | `src/app/api/payment/intent/route.ts` | API Route | Creates PENDING payment intent for 299,000 + uniqueCode (1-999) with 15-min timeout. |
| `/api/payment/webhook` | `src/app/api/payment/webhook/route.ts` | API Route | Webhook receiver for n8n bank SMS parser; confirms payments and upgrades user status to `EARLY_ACCESS`. |

---

### 2. Main Landing Page (`/`) Component Tree
The active landing page component is `ProductLandingPage.tsx`:
```text
<main className="flex flex-col min-h-screen bg-black">
  ├── <header>
  │     └── <CinematicNav />
  ├── <CarnoExperience />
  │     └── <StoryScroller> (500vh scroll container)
  │           └── <HeroSection> (Sticky 100vh viewport)
  │                 ├── <CarCanvas /> (HTML5 Canvas connected to 120-frame engine)
  │                 ├── <CarStoryOverlay /> (GSAP-driven text milestones)
  │                 └── <div className="absolute bottom-0 ...">
  │                       └── <CTASection /> (Primary & Secondary buttons)
  ├── <TrustSection /> (3 technical cards: 120 frames, no video, mobile optimized)
  └── <LeadCaptureSection /> (English mock contact form)
</main>
```

---

### 3. Detailed Audit of Visible Landing Sections

#### 3.1 Navigation (`CinematicNav.tsx`)
- **Visuals:** Fixed header with Carno logo ("کارنو", red icon "C"), link "نسخه اول", and primary CTA button "دریافت دسترسی اولیه".
- **Interaction:** Clicking either the link or button calls `document.getElementById('waitlist-section')?.scrollIntoView({ behavior: 'smooth' })`.
- **Defect:** No element with `id="waitlist-section"` exists on `ProductLandingPage.tsx`. The button fails silently with no visual or functional response.

#### 3.2 Vehicle Experience (`CarnoExperience.tsx`, `HeroSection.tsx`, `StoryScroller.tsx`)
- **Structure:** Encapsulates a `500vh` scroll track (`StoryScroller`) pinning a sticky `100vh` container (`HeroSection`).
- **Protagonist:** `CarCanvas` renders beneath overlays at `z-index: 0`.
- **Frame Scrubbing:** Smooth 120-frame scrubbing synchronized with scroll progress.
- **Narrative Overlay (`CarStoryOverlay.tsx`):**
  - Uses GSAP timeline triggered by `#carno-story-container`.
  - Copy is completely detached from the Carno product:
    - Phase 1 (0-25%): "کشف زیبایی — طراحی فراتر از زمان. خطوط آیرودینامیک..."
    - Phase 2 (25-50%): "فناوری فردا — سیستم هوشمند رانندگی. متصل به دنیای اطراف..."
    - Phase 3 (50-75%): "قدرت بی‌نهایت — شتاب صفر تا صد در کسری از ثانیه..."
    - Phase 4 (75-100%): "آینده اینجاست — آماده ورود به نسل جدید خودروهای الکتریکی هستید؟"

#### 3.3 Hero CTAs (`CTASection.tsx`)
- **Elements:** Two competing equal-size buttons:
  - "شروع تجربه" (Primary)
  - "دریافت اطلاعات" (Secondary)
- **Defect:** Neither button performs navigation, registration, or scrolling. They only invoke `CarnoAnalytics.track(...)`, which writes to `console.debug`.

#### 3.4 Trust Section (`TrustSection.tsx`)
- **Content:**
  - Card 1: "۱۲۰ فریم سینمایی — تجربه‌ای بی‌نظیر با کیفیت استودیویی"
  - Card 2: "تعاملی بدون ویدیو — رندرینگ در لحظه بدون تاخیر بافت‌های ویدئویی"
  - Card 3: "بهینه شده برای موبایل — مصرف هوشمند حافظه و اینترنت با فرمت WebP"
- **Defect:** Violates Section 0 of `CARNO_PROMPT.md` ("The purpose is NOT to showcase engineering. The purpose is NOT to explain the internal rendering architecture"). Contains zero information on the maker, company, security, or product credibility.

#### 3.5 Lead Capture / Registration (`LeadCaptureSection.tsx`)
- **Content:** English text: "Ready to experience the future? Leave your details below and we will notify you when the full 3D interactive platform is publicly available."
- **Fields:** "Full Name", "Email address or Phone number", CTA "Get Early Access".
- **Defect:**
  1. Language is English, alienating Iranian automotive buyers.
  2. Submitting merely sets `submitted: true` locally; it does not connect to Prisma, does not send an OTP, does not register the user, and does not record the lead in any persistent store.

#### 3.6 Footer
- **Defect:** No footer is rendered on `ProductLandingPage.tsx`. The page abruptly ends after the English lead capture section. An unmounted legacy footer (`src/components/landing/Footer.tsx`) exists in the codebase but is not imported.

---

## B. ACTIVE CAR RENDERING PATH

The active car rendering pipeline has been verified end-to-end:

```text
src/app/page.tsx
       │
       ▼
src/features/carno-experience/pages/ProductLandingPage.tsx
       │
       ▼
src/features/carno-experience/components/CarnoExperience.tsx
       │
       ├── uses: src/features/carno-experience/hooks/useCarnoExperience.ts
       │           │
       │           ├── fetches: /car-frames/v1/manifest.json
       │           │
       │           ├── initializes Engine:
       │           │     ├── AssetResolver (src/features/carno-experience/engine/loader/AssetResolver.ts)
       │           │     ├── FrameLoader   (src/features/carno-experience/engine/loader/FrameLoader.ts)
       │           │     ├── LoadQueue     (src/features/carno-experience/engine/loader/LoadQueue.ts)
       │           │     ├── BitmapCache   (src/features/carno-experience/engine/cache/BitmapCache.ts)
       │           │     ├── FrameController (src/features/carno-experience/engine/renderer/FrameController.ts)
       │           │     └── CanvasRenderer  (src/features/carno-experience/engine/renderer/CanvasRenderer.ts)
       │           │
       │           └── executes progressive loading priority:
       │                 Priority 1 (HERO): Frame 1
       │                 Priority 2 (KEYFRAMES): Frames [1, 30, 60, 90, 120]
       │                 Priority 3 (SECONDARY): Frames [15, 45, 75, 105]
       │                 Priority 4 (BACKGROUND): All remaining frames 1..120
       │
       ├── wraps: src/features/carno-experience/components/StoryScroller.tsx
       │           │
       │           └── GSAP ScrollTrigger (trigger: #carno-story-container, scrub: true)
       │                 └── updates controller: controller.updateProgress(progress)
       │
       └── renders: src/features/carno-experience/components/CarCanvas.tsx
                     │
                     └── HTML5 <canvas> receiving pre-decoded ImageBitmaps via CanvasRenderer
```

### Verification Findings:
1. `CanvasRenderer` uses `requestAnimationFrame` to draw the active bitmap into the attached canvas context (`alpha: true`), resolving nearest loaded frames if target frames are loading.
2. The asset manifest at `public/car-frames/v1/manifest.json` specifies:
   - `frameCount: 120`
   - `defaultFrame: 1`
   - `keyframes: [1, 30, 60, 90, 120]`
   - `desktop`: 1600px WebP, quality 80 (120 files present)
   - `mobile`: 960px WebP, quality 75 (120 files present)
3. The rendering path is completely decoupled from React state renders during scrolling, avoiding any main-thread UI jank.

---

## C. PROTECTED FILES BOUNDARY

### 1. Absolutely Protected Files (FORBIDDEN from modification)
The following directories and files must remain untouched:

```text
public/car-frames/v1/
├── manifest.json
├── desktop/
│   ├── frame-001.webp ... frame-120.webp
└── mobile/
    ├── frame-001.webp ... frame-120.webp

src/features/carno-experience/engine/
├── loader/
│   ├── AssetResolver.ts
│   ├── FrameLoader.ts
│   ├── LoadQueue.ts
│   ├── types.ts
│   └── index.ts
├── cache/
│   ├── BitmapCache.ts
│   ├── LRUCache.ts
│   ├── MemoryManager.ts
│   ├── types.ts
│   └── index.ts
└── renderer/
    ├── CanvasRenderer.ts
    ├── FrameController.ts
    ├── types.ts
    └── index.ts
```

### 2. Behavior-Sensitive Integration Components (Must preserve rendering behavior)
The following integration files wrap the engine:
- `src/features/carno-experience/components/CarnoExperience.tsx`
- `src/features/carno-experience/components/CarCanvas.tsx`
- `src/features/carno-experience/components/StoryScroller.tsx`
- `src/features/carno-experience/hooks/useCarnoExperience.ts`

**Phase A Location of Customer-Facing Copy:**
Customer-facing Hero/story copy is currently located in:
1. `src/features/carno-experience/sections/CarStoryOverlay.tsx`
2. `src/features/carno-experience/sections/CTASection.tsx`
3. `src/features/carno-experience/sections/HeroSection.tsx`
4. `src/features/carno-experience/sections/TrustSection.tsx`
5. `src/features/carno-experience/sections/LeadCaptureSection.tsx`
6. `src/components/cinematic/CinematicNav.tsx`

None of the marketing copy is embedded inside the protected engine files or inside `CarCanvas.tsx`.

---

## D. EXISTING BACKEND CAPABILITIES

### 1. Authentication & OTP Verification
The project currently has two parallel OTP implementations:
- **Implementation 1 (Server Actions in `src/app/actions/auth.ts`):**
  - Generates a 5-digit OTP (`Math.floor(10000 + Math.random() * 90000)`).
  - Hashes code with `bcryptjs` and saves to `oTPVerification` (2-minute expiry).
  - Sends SMS via MeliPayamak REST API (`https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber`).
  - Verifies code (max 3 attempts).
  - Creates/finds `User` and `WaitlistEntry`.
  - **Critical Discrepancy:** Does NOT set a JWT session cookie in the browser.
- **Implementation 2 (Route Handlers in `src/app/api/waitlist/*`):**
  - `POST /api/waitlist/register`: Generates a 4-digit OTP, 5-minute expiry, rate-limits 1 request/min.
  - `POST /api/waitlist/verify`: Verifies OTP, creates user, updates inviter `priorityScore` by +50, creates `Referral` record, signs a 7-day JWT token, and writes an `httpOnly` cookie (`token`).
  - Both `/api/waitlist/status` and `/api/payment/intent` **strictly require** this `token` cookie.

### 2. Waitlist & Rank Calculation
- Schema models: `User` (`WAITLIST`, `EARLY_ACCESS`, `ACTIVE`, `BLOCKED`) and `WaitlistEntry` (`priorityScore` default 10, `referralCode`, `referredBy`, `joinedAt`).
- Rank logic in `/api/waitlist/status/route.ts`:
  ```typescript
  const usersAhead = await prisma.waitlistEntry.count({
    where: {
      OR: [
        { priorityScore: { gt: user.waitlistEntry.priorityScore } },
        { priorityScore: user.waitlistEntry.priorityScore, joinedAt: { lt: user.waitlistEntry.joinedAt } }
      ]
    }
  });
  let currentRank = usersAhead + 1;
  ```
  *(Note: An anomaly exists where if `user.status === 'EARLY_ACCESS'`, it caps rank to `Math.min(currentRank, 1000)`).*
- Rank logic in `auth.ts`: Calculates `finalPosition = positionCount + baseOffset + 1`, reading `WAITLIST_BASE_OFFSET` (defaulting to 300) from `.env`. This artificially adds 300 to the user's position, violating the real data rule.

### 3. Referral System
- Unique 8-character referral code generated via `nanoid(8)`.
- Inviter bonus: In `/api/waitlist/verify`, each confirmed signup increments inviter's `priorityScore` by +50.
- Missing rule: The historical +200 bonus for Early Access paid conversion is not yet implemented in the payment webhook.

### 4. Payment Architecture (Card-to-Card Verification)
- **Model:** `PaymentIntent` with:
  - `amount`: 299,000 Tomans
  - `uniqueCode`: Random integer between 1 and 999
  - `totalAmount`: 299,000 + uniqueCode
  - `status`: `PENDING`
  - `expiresAt`: 15 minutes from creation
- **State Machine:**
  - Intent created via `POST /api/payment/intent`
  - Payment screen (`src/app/payment/page.tsx`) displays card number, holder name, exact total amount, and 15-minute countdown.
  - Polling runs every 5 seconds checking `/api/waitlist/status` for status transition to `EARLY_ACCESS`.
  - In production, a bank SMS triggers an n8n webhook (`n8n-payment-workflow.json`), which calls `POST /api/payment/webhook`.
  - Webhook validates `PAYMENT_WEBHOOK_SECRET`, matches `totalAmount`, marks intent `PAID`, logs to `PaymentLog`, and sets `User.status = 'EARLY_ACCESS'`.

### 5. Analytics Capabilities
- PostHog JS (`posthog-js`) is installed and configured in `src/components/providers/AnalyticsProvider.tsx`.
- Currently tracked in legacy/subpage components:
  - `landing_view`
  - `phone_submitted`, `phone_input_started`
  - `otp_sent`, `otp_verified`
  - `waitlist_joined`, `referral_signup`
  - `waitlist_dashboard_viewed`, `early_access_view`
  - `payment_started`, `payment_success`
- Defect: `useCarnoExperience.ts` and `StoryScroller.tsx` call an internal dummy logger `CarnoAnalytics.track(...)` which only logs to browser console, completely disconnected from PostHog.

---

## E. EXISTING DATA AUDIT (SAMPLE VEHICLE INTELLIGENCE)

- **Status:** **PENDING / UNAVAILABLE**
- **Inspection Result:**
  There is **zero real sanitized vehicle output data** in the repository.
- **Legacy Mock Numbers Found:**
  - `Scene03_PriceDiscovery.tsx`: 850M Toman asking price, 780M Toman Carno valuation, 70M Toman difference.
  - `Scene04_Opportunity.tsx`: 92/100 Opportunity Score.
  - `ProductPreview.tsx`: 85/100 Purchase Value Score, "۴٪ ارزان‌تر از میانگین بازار" (4% cheaper than market average), using a generic dashboard mockup (`/images/dashboard-preview.jpg`).
- **Safety Directive:** In accordance with Section 11 and Section 12.1 of `CARNO_PROMPT.md`, these mock numbers cannot be presented as factual Carno output. The Sample Analysis card must be constructed as a structural template with explicitly labeled placeholders until real sanitized engine data is provided by the human product owner.

---

## F. PRODUCT & MAKER IDENTITY AUDIT

- **Status:** **PENDING / PARTIAL**
- **Existing Identity Information:**
  - Product Name: **کارنو** (Carno)
  - Tagline: "دستیار هوشمند بازار خودرو"
  - Operating Entity: "تیم جی‌هاب" (Jeyhub Team)
  - Assets: `public/images/logo-jeyhub.jpg`
  - Domain mentions: `carno.ir` (in `layout.tsx`) and `carno.app` (in `waitlist/page.tsx`).
- **Missing Information (Section 12.2):**
  - Real maker/founder names.
  - Real team photographs.
  - Real contact channels (support phone number, official Telegram ID, email address).
  - Real office address or business registration details.
- **Safety Directive:** Do NOT invent founder names, fictitious bios, or fake company credentials. The trust layer must be structured with truthful pre-launch messaging and pending placeholders for team contact channels.

---

## G. PAYMENT STATE AUDIT

- **Status:** **TEST-ONLY / NOT PRODUCTION-READY**
- **Evidence:**
  1. Card number in `src/app/payment/page.tsx` (line 17) is an explicit placeholder:  
     `const cardNumber = '۶۰۳۷-۹۹۸۱-۴۵۶۷-۸۹۰۱'; // Mock for Demo`
  2. Account holder name is `کارنو (جی‌هاب)`.
  3. Environment variables `PAYMENT_CARD_NUMBER` and `PAYMENT_CARD_HOLDER_NAME` are empty in `.env.example`.
  4. **Refund and Cancellation Policy is PENDING (Section 12.3).**
- **Safety Directive:** In accordance with Section 18 of `CARNO_PROMPT.md`, live payments must remain strictly disabled. The conversion redesign will provide a complete, interactive test UX for the Early Access flow without capturing real financial transactions.

---

## H. ANALYTICS INTEGRATION AUDIT

### 1. Provider Setup
`src/components/providers/AnalyticsProvider.tsx` initializes PostHog if `NEXT_PUBLIC_POSTHOG_KEY` is present. It also conditionally injects Google Analytics (`NEXT_PUBLIC_GA_ID`) and Microsoft Clarity (`NEXT_PUBLIC_CLARITY_ID`).

### 2. Disconnect Between Engine and PostHog
`StoryScroller.tsx` and `useCarnoExperience.ts` fire events through `CarnoAnalytics.track(...)`:
```typescript
export const CarnoAnalytics = {
  track: (eventName: string, payload?: Record<string, any>) => {
    console.debug(`[Carno Analytics] ${eventName}`, payload);
  }
};
```
These events are never routed to PostHog. In Phase C, `CarnoAnalytics.track` must be linked directly to `posthog.capture` (safely guarding against undefined window/posthog).

### 3. High-Frequency Tracking Check
Neither `CanvasRenderer` nor the `requestAnimationFrame` loop contains analytics calls. Tracking in `StoryScroller.tsx` is properly gated behind milestone arrays (`[0.25, 0.5, 0.75, 1.0]`) and state transitions (`PHASES`), adhering to the performance rules.

---

## I. CURRENT COPY & CLAIMS AUDIT

| Component | Current Copy / Claim | Reality Check | Assessment |
|---|---|---|---|
| `layout.tsx` | "کارنو - دستیار هوشمند بازار خودرو... قبل از خرید خودرو، بازار را بهتر بشناسید..." | Aligns with core product positioning. | **CONFIRMED** |
| `CarStoryOverlay.tsx` | "کشف زیبایی... خطوط آیرودینامیک...", "شتاب صفر تا صد...", "ورود به نسل جدید خودروهای الکتریکی" | False marketing copy describing an electric car for sale, completely misrepresenting Carno. | **INVALID / MUST REPLACE** |
| `CTASection.tsx` | "شروع تجربه", "دریافت اطلاعات" | Non-functional buttons with vague copy. | **INVALID / MUST REPLACE** |
| `TrustSection.tsx` | "۱۲۰ فریم سینمایی", "تعاملی بدون ویدیو", "بهینه شده برای موبایل" | Technical architecture boasting, gives user no reason to trust the product. | **INVALID / MUST REPLACE** |
| `LeadCaptureSection.tsx` | "Ready to experience the future?... notify you when the full 3D interactive platform is publicly available." | English text, fake submission, describes a 3D platform instead of automotive intelligence. | **INVALID / MUST REPLACE** |
| `WaitlistForm.tsx` (Unmounted) | "اولین نسخه کارنو از همینجا شروع میشود... به جمع محدود کاربران اولیه بپیوندید..." | Persian-first, benefit-led waitlist copy. | **REUSABLE IN REDESIGN** |
| `EarlyAccess.tsx` (Unmounted) | "نسخه اول را با اولین کاربران می‌سازیم... ۲۹۹,۰۰۰ تومان" | Clear pricing and tier benefits. | **REUSABLE IN REDESIGN** |
| `Problem.tsx` (Unmounted) | "ظاهر سالم ≠ معامله خوب، قیمت آگهی ≠ ارزش واقعی..." | Strong, benefit-led problem articulation. | **REUSABLE IN REDESIGN** |
| `waitlist/page.tsx` | Fake recent users: "۰۹۱۲***۴۵۱۲", "۰۹۳۵***۷۸۹۰", "دقایقی پیش" | Deceptive urgency / fabricated activity. | **PROHIBITED DARK PATTERN** |
| `auth.ts` | `WAITLIST_BASE_OFFSET = 300` | Artificially inflates waitlist numbers by 300. | **FABRICATED RANK / MUST REMOVE** |

---

## J. CONVERSION PROBLEMS AUDITED

1. **Total Product Identity Distortion:** A visitor landing on `/` believes they are looking at a showcase for a futuristic electric vehicle, not an automotive price intelligence tool.
2. **Missing Product Story & 3-Step Explanation:** The visitor is never told how Carno works:
   - Step 1: نیازت را مشخص کن
   - Step 2: Carno بازار را بررسی می‌کند
   - Step 3: گزینه‌هایی را ببین که ارزش بررسی دارند
3. **Dead-End CTAs:**
   - The top navbar CTA points to non-existent `#waitlist-section`.
   - The Hero bottom CTAs merely log debug strings.
   - The English lead form sets a local React state and drops the lead into oblivion.
4. **Bypassed Production Auth Pipeline:** The entire database-backed OTP, phone verification, and JWT session infrastructure is completely disconnected from the landing page.
5. **No Sample Output Section:** Visitors cannot see what a Carno analysis looks like (price assessment, opportunity score, listing signals).
6. **No Pre-Launch Clarity:** The page does not state that Carno is in preparation for launch in approximately one month.
7. **No Truthful Urgency:** Artificial inflation (+300 offset) and fake user lists exist in the waitlist dashboard instead of honest queue counts.
8. **Color Scheme & CSS Tokens Clash:**
   - `layout.tsx` forces `dark` class and `bg-[#020617]`.
   - `globals.css` specifies Light Premium tokens (`--color-bg-primary: #FFFFFF`).
   - `ProductLandingPage.tsx` and `HeroSection.tsx` force `bg-black`.
9. **Mobile Overlay Risk:** `CarStoryOverlay.tsx` uses hardcoded negative margins (`mt-[-20%]`), causing text overlays to collide with or obstruct the car canvas on mobile viewports.

---

## K. RISK MATRIX

| Risk Category | Severity | Description | Mitigation Strategy |
|---|---|---|---|
| **Protected Engine Risk** | **CRITICAL** | Accidental modification to `src/features/carno-experience/engine/**` or `public/car-frames/v1/**` breaking the 120-frame rendering pipeline. | Treat directory as strictly read-only. Run `git diff --stat -- src/features/carno-experience/engine public/car-frames` after every step to verify zero changes. |
| **Asset Integrity Risk** | **CRITICAL** | Renaming, recompressing, or moving frames in `/car-frames/v1/` causing missing frame exceptions or broken manifests. | Assets are frozen. No file in `public/car-frames/v1` will be touched. |
| **Business Logic & Auth Risk** | **HIGH** | Disconnect between `auth.ts` (which does not set JWT cookie) and `/api/waitlist/*` (which sets cookie and updates referral score). | Standardize on the secure Route Handler flow (`/api/waitlist/register` and `/api/waitlist/verify`) so JWT cookies are properly issued for subsequent rank and payment operations. |
| **Payment Risk** | **HIGH** | Processing live payments without a merchant account or finalized refund/cancellation policy. | Keep payment CTA in test/disabled mode. Display clear pre-launch test indicator. |
| **Fabricated Content Risk** | **HIGH** | Manufacturing fake market values (e.g. 620M), fake opportunity scores, fake user lists, or fake testimonials to fill UI cards. | Use structural placeholders clearly marked as "نمونه نمایشی از خروجی Carno". Do not invent real-world numbers. |
| **Data Availability Gap** | **MEDIUM** | Real vehicle analysis engine output is currently PENDING from the product owner. | Implement the UI architecture to accept the real data schema, but render cleanly with placeholder indications until provided. |

---

## PHASE A COMPLETION & STOP GATE

Phase A read-only audit is **COMPLETE**.

In strict compliance with **Section 39 and Section 40 of CARNO_PROMPT.md**:
- **STOPPING EXECUTION IMMEDIATELY.**
- **NO UI changes have been implemented.**
- **NO source code has been modified.**
- **NO packages have been installed.**
- **NO engine or car asset files have been touched.**

Awaiting **explicit human approval of Gate 1** before proceeding to **Phase B (Experience Specification)**.
