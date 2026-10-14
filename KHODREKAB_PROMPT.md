# CARNO PRODUCTION CONVERSION EXPERIENCE
## Master Implementation Prompt — Human-Gated, Production-Safe

> Project: Carno / کارنو
> Repository: radifo-khodro-landing
> Branch for this work: conversion-redesign
> Product stage: Pre-launch
> Expected launch window: approximately one month from the current planning point
> Implementation model: Phase A → STOP → Human Review → Phase B → STOP → Human Review → Phase C
>
> IMPORTANT:
> This document is the source of truth for the conversion redesign.
> Read this entire file before taking any implementation action.

---

# 0. PRIMARY OBJECTIVE

Redesign the Carno landing experience into a premium, high-conversion, product-led automotive experience.

The purpose is NOT to showcase engineering.

The purpose is NOT to explain the internal rendering architecture.

The purpose is NOT to make the site look like a generic AI SaaS landing page.

The purpose is to make the visitor:

1. immediately notice the product,
2. understand the problem it solves,
3. become curious about how it can help,
4. recognize the value of making better car-buying decisions,
5. understand what Carno actually provides,
6. trust the product and its creators,
7. register with minimal friction,
8. understand their real position in the early-access queue,
9. become interested in Early Access,
10. and eventually convert into a paid Early Access user when live payment is legitimately enabled.

The experience should communicate:

> "Carno helps you evaluate vehicle opportunities with numbers and signals instead of guesswork."

A key positioning concept is:

> **با عدد، نه با حدس**

Do not overuse this phrase.
It should function as a memorable product distinction, not as a repeated slogan.

---

# 1. NON-NEGOTIABLE PROTECTION RULE

The existing 3D vehicle experience is already approved.

DO NOT redesign it.

DO NOT replace it.

DO NOT simplify it.

DO NOT "improve" it.

DO NOT change its appearance.

DO NOT change its rendering architecture.

DO NOT modify its assets.

DO NOT modify its frame sequence.

DO NOT alter its scroll mapping.

DO NOT migrate it to another rendering technology.

DO NOT touch protected Engine or asset files unless explicit human approval is given outside this prompt.

The existing car experience is considered frozen and approved.

All conversion, storytelling, typography, layout, CTA, marketing, trust, registration, and payment experience work must happen AROUND the existing car experience.

---

# 2. FROZEN VEHICLE EXPERIENCE

The following elements are protected:

## 2.1 3D vehicle

The vehicle appearance is approved and must remain visually identical.

Do not modify:

- vehicle model
- materials
- textures
- reflections
- lighting
- shadows
- camera
- composition
- position
- scale
- framing
- background relationship
- proportions

The vehicle is the protagonist of the experience.

---

## 2.2 120-frame experience

The approved experience consists of:

- 120 frames
- approximately 3° per frame
- true 360° rotation
- scroll-driven frame progression

Do not change:

- frame count
- frame order
- frame mapping
- frame interpolation behavior
- scroll-to-frame relationship

---

## 2.3 Production assets

Current approved structure:

```text
public/car-frames/v1/
├── manifest.json
├── desktop/
│   ├── frame-001.webp
│   ├── frame-002.webp
│   ├── ...
│   └── frame-120.webp
└── mobile/
    ├── frame-001.webp
    ├── frame-002.webp
    ├── ...
    └── frame-120.webp
```

Manifest:

```text
version: v1
frameCount: 120
defaultFrame: 1
keyframes: [1, 30, 60, 90, 120]
basePath: /car-frames/v1
desktop directory: desktop
mobile directory: mobile
```

Do not rename, relocate, regenerate, recompress, replace, or modify these production assets.

---

# 3. PROTECTED ENGINE

The current rendering chain is approved:

```text
src/app/page.tsx
        ↓
ProductLandingPage
        ↓
CarnoExperience
        ↓
CarCanvas
        ↓
useCarnoExperience
        ↓
Engine
        ↓
/public/car-frames/v1
```

Protected engine areas include:

```text
src/features/carno-experience/engine/
├── loader/
│   ├── types.ts
│   ├── AssetResolver.ts
│   ├── FrameLoader.ts
│   ├── LoadQueue.ts
│   └── index.ts
│
├── cache/
│   ├── types.ts
│   ├── LRUCache.ts
│   ├── MemoryManager.ts
│   ├── BitmapCache.ts
│   └── index.ts
│
└── renderer/
    ├── types.ts
    ├── FrameController.ts
    ├── CanvasRenderer.ts
    └── index.ts
```

Also protected:

```text
src/features/carno-experience/components/CarnoExperience.tsx
src/features/carno-experience/components/CarCanvas.tsx
src/features/carno-experience/components/StoryScroller.tsx
src/features/carno-experience/hooks/useCarnoExperience.ts
```

The protected engine behavior includes:

* Canvas rendering
* ImageBitmap
* requestAnimationFrame
* frame controller
* progressive loading
* FrameLoader
* LoadQueue
* BitmapCache
* LRU cache
* MemoryManager
* fallback frame resolution
* nearest-loaded fallback
* target/nearby loading priority
* keyframe protection
* responsive desktop/mobile asset selection
* reduced-motion fallback
* scroll-to-frame mapping

Do not replace these mechanisms with:

* CSS animation
* video
* GIF
* `<img>` frame swapping
* a different animation library
* a different rendering engine
* a completely different Canvas architecture

unless the human explicitly authorizes it.

---

# 4. SAFETY PRINCIPLE

Before modifying anything:

1. inspect the current implementation,
2. understand existing behavior,
3. separate protected code from editable experience code,
4. identify dependencies and data already available,
5. identify what is real and what is still planned,
6. do not invent missing product capabilities,
7. do not fabricate marketing evidence,
8. do not silently change business logic.

When uncertain:

* document the uncertainty,
* mark it for human review,
* do not invent an answer,
* do not silently weaken the requirement,
* do not silently redefine the product.

---

# 5. PRODUCT REALITY

Carno is an automotive intelligence product intended to help users identify vehicle purchase opportunities and make better decisions.

The expected launch capability set includes these five product areas:

### 1. Market Price Intelligence

"قیمت واقعی بازار"

Carno analyzes market information to help the user understand whether an asking price appears:

* expensive,
* reasonable,
* or potentially attractive relative to market conditions.

Do not imply mathematical certainty.

---

### 2. Below-Market Opportunity Detection

"زیر قیمت بازار"

Carno should identify vehicles that appear to be priced below the relevant market level and therefore may deserve closer review.

Do not promise that every detected opportunity is genuinely profitable.

---

# 3. PROTECTED ENGINE AND ASSET BOUNDARY

The following are absolutely protected:

public/car-frames/v1/**

src/features/carno-experience/engine/**

These files must not be modified during the conversion redesign unless explicit human approval is given.

The following integration components are behavior-sensitive and must be audited before implementation:

src/features/carno-experience/components/CarnoExperience.tsx
src/features/carno-experience/components/CarCanvas.tsx
src/features/carno-experience/components/StoryScroller.tsx
src/features/carno-experience/hooks/useCarnoExperience.ts

They are NOT automatically forbidden from modification.

However:

- preserve the existing car behavior,
- preserve the rendering pipeline,
- preserve frame mapping,
- preserve asset resolution,
- preserve loading/caching behavior,
- preserve scroll behavior.

During Phase A, determine exactly where customer-facing Hero/story copy is defined.

If required copy is located inside one of these integration components, document that fact in CARNO_CONVERSION_AUDIT.md.

Do not modify those files during Phase A.

If Phase C requires changing one of them only to implement approved customer-facing copy/layout:

1. identify the exact file,
2. identify the exact relevant code,
3. explain why the change is necessary,
4. preserve all protected behavior,
5. obtain explicit human approval before modifying it.

Never modify the Engine or production car assets merely to move or change marketing copy.

---

### 4. Listing / Seller Signals

Carno can analyze listing information and infer signals about the likely seller/listing context.

For example:

* ordinary/private seller signals
* dealer signals
* showroom signals
* listing characteristics that may deserve closer attention

IMPORTANT:

These are probabilistic signals.

Never write:

> "Carno knows who the seller is."

Never write:

> "Carno always detects dealers."

Prefer wording such as:

> "نشانههای آگهی و فروشنده"

> "احتمال نوع فروشنده"

> "بر اساس نشانههای موجود در آگهی"

---

### 5. Purchase Opportunity Score

Carno can produce an opportunity-style score such as:

> 87/100

This must represent an actual supported product output.

Do not fabricate sample values.

Do not imply the score guarantees profitability.

---

# 6. CUSTOMER-FACING POSITIONING

The product should be positioned around the user's decision.

The product is not primarily about:

* AI
* automation
* technical architecture
* APIs
* machine learning terminology
* scraping
* databases
* Canvas
* frame rendering
* ImageBitmap
* LRU
* MemoryManager
* n8n
* backend infrastructure

Those things may matter technically.

They are not the primary reason a customer should care.

The customer-facing narrative should focus on:

* price
* opportunity
* risk awareness
* saved time
* better filtering
* better decisions
* finding vehicles worth reviewing

---

# 7. CORE PSYCHOLOGICAL FLOW

The page should follow this emotional and cognitive sequence:

```text
ATTRACTION
↓
PROBLEM RECOGNITION
↓
CURIOSITY
↓
DESIRE FOR A BETTER DECISION
↓
UNDERSTANDING OF CARNO
↓
TRUST
↓
LOW-FRICTION REGISTRATION
↓
PERSONAL OWNERSHIP / POSITION
↓
EARLY ACCESS DESIRE
↓
CONVERSION
```

Do not make the visitor process too many ideas simultaneously.

At any given moment, there should be one dominant message.

---

# 8. HERO EXPERIENCE

The hero should be cinematic, premium, automotive, and product-led.

The car remains the protagonist.

As the user scrolls, the message evolves with the vehicle's visual progression.

Use the car movement to reveal narrative rather than presenting a static wall of text.

---

## HERO PHASE 1 — FRONT / FIRST IMPRESSION

Primary message:

> **این خودرو واقعاً چقدر میارزد؟**

Supporting message:

> Carno قیمت بازار را بررسی میکند تا بفهمی یک آگهی گران است، منصفانه است یا میتواند فرصت خرید باشد.

The visitor should immediately understand:

> "This is about discovering whether a car is actually worth its asking price."

---

## HERO PHASE 2 — SIDE / OPPORTUNITY

Primary message:

> **فرصتهای زیر قیمت بازار را قبل از بقیه پیدا کن.**

Supporting message:

> از میان گزینههای بازار، خودروهایی را که ارزش بررسی بیشتری دارند برایت مشخص میکنیم.

Avoid absolute promises.

Do not imply guaranteed profit.

---

## HERO PHASE 3 — REAR / HIDDEN SIGNALS

Primary message:

> **قبل از تماس، چیزی را ببین که در آگهی دیده نمیشود.**

Supporting message:

> نشانههای مهم آگهی و فروشنده را کنار هم ببین تا وقتت را برای گزینهی اشتباه نگذاری.

Use probabilistic language when referring to seller/listing classification.

---

## HERO PHASE 4 — RETURN / DECISION

Primary message:

> **ماشین بعدیات را با عدد انتخاب کن، نه با حدس.**

Supporting message:

> هر گزینه میتواند یک امتیاز فرصت خرید داشته باشد. ثبتنام اولیه رایگان است.

This is a key brand-level message.

---

# 9. PRE-LAUNCH TRANSPARENCY

Carno is in preparation and is not currently being presented as a fully launched public service.

Near the primary Hero CTA, show a small persistent status message:

> **در حال آمادهسازی · لانچ حدود یک ماه دیگر**

This should be visually secondary.

It should communicate honest product status without dominating the hero.

Do not invent an exact launch date.

Do not create a fake countdown.

Do not create artificial urgency.

Do not say:

> "Only 3 days left"

unless such a statement is actually true and human-approved.

---

# 10. HERO CTA STRATEGY

Use one dominant CTA.

Primary CTA:

> **دریافت دسترسی اولیه**

Secondary action should be a text link rather than another competing large button:

> **نمونه تحلیل را ببین ↓**

Under the CTA:

> **ثبتنام اولیه رایگان · فقط شماره موبایل**

Do NOT use:

> "کمتر از ۱۰ ثانیه"

unless the real OTP flow has been measured and validated.

Do not make unverified speed claims.

---

# 11. SAMPLE ANALYSIS SECTION

Create a section titled:

> **نمونه تحلیل Carno**

The card must visibly contain this label inside the card:

> **نمونه نمایشی از خروجی Carno**

This label must be visually attached to the card so that screenshots cannot easily detach the result from its "sample/demo" context.

---

## REQUIRED SAMPLE CONTENT

The preferred sample can contain fields such as:

* asking price
* estimated market price
* opportunity score
* seller/listing signals
* brief interpretation

BUT:

ALL VALUES MUST COME FROM REAL SANITIZED PRODUCT OUTPUT.

Examples must not be fabricated merely for visual design.

Do NOT invent:

```text
620M
680M
87/100
```

or any other number merely because it looks realistic.

If actual output is unavailable:

- do not invent sample values,
- design the card structure only,
- use clearly marked empty/sample-data placeholders where necessary,
- keep the real-data dependency explicitly documented,
- do not present placeholder values as actual Carno output.

Mark the dependency as pending.

Do not manufacture a fake realistic result.

---

# 12. HUMAN INPUTS — DO NOT INVENT OR INFER

These are product-owner inputs.

They must not be fabricated, guessed, inferred, or replaced with fake production data.

---

## 12.1 Real Engine Output for Sample Analysis

Status:

PENDING

Required before the Sample Analysis content can be finalized.

Use:

- actual sanitized product output,
- or test data based on real vehicle listings if it reflects the actual supported product flow.

Rules:

- no fabricated prices,
- no fabricated market values,
- no fabricated opportunity scores,
- no fabricated seller signals,
- no fabricated product output.

If still PENDING during Phase B:

- document the dependency,
- design the structure,
- do not present fake data,
- do not claim the sample is real.

---

## 12.2 Real Maker / Team Identity

Status:

PENDING

Required before the Trust section is finalized.

Human input should eventually provide:

- real maker/team name,
- real contact channel,
- real photo if a personal/team photo is intended.

Never invent:

- founder names,
- credentials,
- companies,
- awards,
- partnerships,
- testimonials,
- user counts,
- press mentions,
- customers,
- certifications.

---

## 12.3 Refund / Cancellation Policy

Status:

PENDING

This must be finalized by the human product owner before live payment is enabled.

Do not invent:

- refund duration,
- eligibility,
- cancellation rules,
- guarantees,
- payment terms.

Until finalized:

- payment must remain disabled/test-only,
- UX can still be implemented,
- no real transaction may be processed.

---

# 13. THREE-STEP PRODUCT EXPLANATION

After the cinematic hero and sample analysis, explain the value in simple customer language.

Use three clear steps:

### Step 1

> **نیازت را مشخص کن**

The user tells Carno what kind of vehicle opportunity they are looking for.

---

### Step 2

> **Carno بازار را بررسی میکند**

Carno analyzes the available information according to the user's need and the supported product logic.

---

### Step 3

> **گزینههایی را ببین که ارزش بررسی دارند**

The user receives useful vehicle opportunities and relevant signals.

Avoid technical headings such as:

* Detection
* Intelligence Layer
* Automation
* Processing Pipeline
* AI Engine
* Data Extraction
* Result Generation

The explanation should remain user-centered.

---

# 14. TRUST LAYER

Create a trust section that explains:

* what Carno is,
* who is building it,
* what stage it is currently in,
* how phone numbers are used,
* why registration is collected,
* how users can contact the maker/team.

Use real information only.

Preferred structure:

```text
Who is building Carno
↓
What stage we are in
↓
What your phone number is used for
↓
How to contact us
```

Do not fabricate social proof.

Do not create:

* fake testimonials,
* fake customer logos,
* fake user numbers,
* fake reviews,
* fake media coverage,
* fake investor logos,
* fake badges,
* fake partnerships.

Real trust is more important than visual persuasion.

---

# 15. WAITLIST REGISTRATION

Create a low-friction phone registration experience.

Headline:

> **برای دریافت دسترسی اولیه، جایگاهت را ثبت کن.**

Input:

```text
شماره موبایل
```

Primary action:

> **دریافت کد دسترسی**

Reuse the existing:

* authentication flow,
* OTP flow,
* MeliPayamak integration,
* backend validation.

Do not create a parallel fake auth system.

---

# 16. POST-OTP PERSONAL STATUS

After successful OTP verification, show real registration state.

Example:

> **ثبتنامت با موفقیت انجام شد.**

Then:

> **جایگاه فعلی تو**

```text
# REAL_POSITION
```

Then:

> **در صف دسترسی اولیه**

The position MUST come from the real backend.

Never fabricate:

* rank,
* total registrations,
* number of users,
* queue size.

If the queue is still small, truthful messaging is acceptable:

> **در حال تشکیل اولین گروه کاربران Carno**

---

# 17. EARLY ACCESS

Early Access should appear after registration rather than being the primary first-screen pitch.

Headline:

> **میخواهی جزو نسل اول Carno باشی؟**

Price:

> **۲۹۹٬۰۰۰ تومان**

Primary CTA:

> **فعالسازی دسترسی نسل اول**

The section must clearly explain:

* what the user is paying for,
* what Early Access means,
* what level of priority or access is provided,
* expected launch timing,
* relevant conditions,
* refund/cancellation policy once finalized.

Do not invent scarcity.

Do not invent:

* fake limited slots,
* fake countdown,
* fake "only 12 remaining",
* fake discounts,
* fake number of purchasers.

---

# 18. PAYMENT IMPLEMENTATION RULE

The live payment system must NOT be enabled yet.

However, the UX should be implemented sufficiently to test the experience.

The payment CTA may exist in:

> disabled / test-only mode

The flow should be reviewable without processing a real transaction.

Do not process real money.

Do not create live payment credentials.

Do not enable production payment until:

1. the refund/cancellation policy is finalized,
2. the product owner explicitly approves activation,
3. the final payment logic is verified.

Existing business rules must not be silently changed.

If the project already contains a specific payment implementation or card-to-card architecture, preserve its approved business logic unless explicitly instructed otherwise.

---

# 19. REFERRAL EXPERIENCE

If referral logic already exists, reuse it.

Do not silently redefine scoring.

Historically approved business logic:

```text
+50 successful invited signup
+200 Early Access conversion
```

BUT:

Before displaying these values, inspect the actual backend implementation.

The frontend must reflect the real backend logic.

If the backend differs from these historical values:

* do not silently change backend logic,
* do not silently display old numbers,
* document the discrepancy for human review.

Suggested messaging:

> **با دعوت از دوستان، اولویت دسترسی خودت را بهتر کن.**

Do not use fabricated invite counts.

---

# 20. URGENCY PRINCIPLES

Urgency should be based on truthful product state.

Allowed:

* real waitlist position,
* real Early Access availability,
* real launch stage,
* real onboarding priority,
* real product milestones.

Not allowed:

* fake scarcity,
* fake countdowns,
* fake users,
* fake activity,
* fake "X people joined",
* fake testimonials,
* fake queue entries,
* fake notifications.

Create urgency through genuine anticipation, not deception.

---

# 21. VISUAL DIRECTION

The visual language should feel:

* premium
* automotive
* modern
* trustworthy
* intelligent
* restrained
* clean
* high quality

Avoid:

* generic dark AI dashboards,
* cyberpunk,
* excessive neon,
* gaming aesthetics,
* childish visuals,
* overly futuristic visuals,
* visual noise,
* template-like SaaS layouts.

Preferred base direction:

### Light premium red/white automotive language

Use the existing visual identity where appropriate.

Reference direction:

* polished Persian RTL visual quality inspired by premium Iranian digital products,
* sophisticated motion quality,
* cinematic scroll storytelling.

Do NOT copy any reference website or brand literally.

References are for visual quality and interaction principles only.

---

# 22. BRAND COLOR DIRECTION

Existing preferred palette:

```text
#050814
#0B1124
#111830
#1E293B

Primary red:
#E31C4E

Hover red:
#C21641

Primary text:
#F8FAFC

Muted text:
#94A3B8
```

Use judgment around the new light/premium direction.

Do not blindly force dark surfaces everywhere.

The visual identity should feel coherent rather than mechanically applying every listed color.

---

# 23. TYPOGRAPHY AND RTL

The experience must remain:

* Persian-first,
* RTL,
* readable,
* premium,
* responsive.

Typography should prioritize:

1. hierarchy,
2. readability,
3. line length,
4. spacing,
5. scanability.

Do not create excessively dense text blocks.

Do not hide important information simply to make the design look cleaner.

---

# 24. RESPONSIVE EXPERIENCE

Mobile is not a scaled desktop.

The design must adapt intentionally.

Requirements:

* touch-friendly controls,
* readable Persian typography,
* appropriate spacing,
* preserved narrative,
* correct Canvas fallback,
* correct mobile car assets,
* no horizontal overflow,
* no CTA collision,
* no text obstruction over the car.

Do not destroy the storytelling just to reduce page length on mobile.

---

# 25. ACCESSIBILITY

Preserve and improve accessibility.

Requirements include:

* meaningful headings,
* logical hierarchy,
* keyboard accessibility,
* visible focus states,
* readable contrast,
* usable form controls,
* accessible CTA labels,
* reduced-motion support,
* Canvas fallback content.

The visual experience must not prevent access to the underlying content.

---

# 26. REDUCED MOTION

Existing reduced-motion behavior must be preserved.

Do not remove it.

Do not make the page dependent exclusively on motion to understand the product.

A visitor who prefers reduced motion must still receive the complete product narrative and conversion flow.

---

# 27. SEO

Preserve existing:

* metadata,
* title,
* description,
* canonical configuration,
* structured data where applicable,
* semantic HTML.

Do not sacrifice SEO for cinematic effects.

Customer-facing product copy should remain natural Persian.

---

# 28. ANALYTICS

Use the existing PostHog installation.

Do NOT introduce another analytics package.

Potential meaningful events:

```text
hero_loaded
car_story_phase_reached
car_scroll_depth
cta_visible
cta_clicked

registration_started
otp_started
otp_verified

waitlist_position_viewed

early_access_viewed
early_access_clicked
early_access_completed

referral_viewed
referral_shared
```

Only implement events that map to real user behavior.

Do NOT track:

* every frame,
* every pixel of scrolling,
* every render loop,
* high-frequency canvas updates.

Analytics must not interfere with the rendering loop.

---

# 29. EXISTING BACKEND REUSE

Reuse existing backend functionality.

Do not create redundant systems when functionality already exists.

Expected existing areas may include:

* Prisma
* PostgreSQL
* OTP
* MeliPayamak
* authentication
* JWT/session handling
* waitlist
* referral logic
* payment intent/state
* PostHog

Before implementing anything:

inspect the repository and identify existing functionality.

Do not build a parallel implementation because it is easier.

---

# 30. PRODUCT LOGIC PROTECTION

Do not silently change business rules.

Examples:

* referral score,
* OTP behavior,
* waitlist ordering,
* payment state machine,
* expiration windows,
* registration logic,
* authentication flow.

UI changes must reflect backend reality.

When frontend and backend disagree:

document the discrepancy and request human review.

Do not "fix" the business logic silently.

---

# 31. EXISTING PAYMENT ARCHITECTURE

The project may already contain a custom payment flow based on:

* card-to-card payment,
* unique amount suffixes,
* pending payment state,
* bank SMS verification,
* n8n,
* webhook callbacks,
* payment logs,
* expiration.

Do not replace or simplify this architecture unless explicitly instructed.

Inspect the current implementation first.

Preserve approved business rules.

The redesign concerns the experience, not an unauthorized redesign of financial business logic.

---

# 32. CODE QUALITY

All implementation must remain production-oriented.

Requirements:

* TypeScript correctness
* clean React architecture
* no duplicated components without reason
* no dead imports
* no unnecessary dependencies
* no fake data in production-facing flows
* no console spam
* no broken states
* no layout shifts caused by avoidable loading behavior
* no secret exposure
* no client-side exposure of private credentials

Use existing project conventions where they are sound.

Do not introduce an architectural rewrite for aesthetic reasons.

---

# 33. DEPENDENCY RULE

Do not install libraries simply because they are popular.

Before adding a dependency:

1. verify whether existing project tooling already solves the problem,
2. check whether the dependency is genuinely necessary,
3. check whether it introduces unnecessary bundle or maintenance cost.

Do not install:

* another animation library,
* another analytics library,
* another form library,
* another UI framework,

unless there is a concrete justified need and human approval where appropriate.

Existing `gsap` usage should not be removed merely for the sake of minimizing package count.

---

# 34. LEGACY CODE

There may be legacy/orphaned components such as:

```text
src/components/cinematic/CinematicStory.tsx
src/components/cinematic/CarCanvas.tsx
```

Do not delete them during the conversion redesign just because they appear unused.

The current task is conversion redesign, not repository cleanup.

If legacy code presents risk, document it.

Deletion requires a separate justified decision.

---

# 35. CONTENT RULES

Customer-facing copy must be:

* Persian,
* natural,
* direct,
* credible,
* benefit-led,
* concise,
* emotionally engaging without hype.

Avoid:

* meaningless marketing adjectives,
* "revolutionary",
* "the future of everything",
* generic AI buzzwords,
* fake certainty,
* fabricated claims,
* technical self-congratulation.

Do not write like an advertisement that is trying too hard.

Write like a serious automotive technology product.

---

# 36. CLAIM VERIFICATION RULE — PHASE B

Every customer-facing product claim must be checked against:

* confirmed project context,
* actual existing backend behavior,
* actual existing product implementation,
* explicit human-approved product capabilities.

If a claim cannot be verified:

DO NOT invent, assume, or silently weaken it.

Instead:

1. mark the claim as requiring human review,
2. document the dependency,
3. keep implementation conservative,
4. do not present the claim as a confirmed production fact.

Phase B is responsible for identifying these uncertainties.

---

# 37. PRE-FLIGHT GIT SAFETY

Before any implementation begins:

### Step 1

Inspect Git status:

```bash
git status --short
git branch --show-current
git log -1 --oneline
```

---

### Step 2

Determine whether the working tree contains unfinished user work.

If there are user changes:

DO NOT overwrite them.

Do not assume they are disposable.

---

### Step 3

Create the dedicated branch:

```bash
git switch -c conversion-redesign
```

If the branch already exists:

inspect it first and do not blindly recreate it.

---

### Step 4

If there are legitimate pre-existing changes that belong to the current baseline, commit them separately BEFORE Antigravity implementation.

The baseline must be distinguishable from the conversion redesign work.

The objective is:

> Any later diff should make it obvious which changes belong to this redesign.

---

# 38. CREATE THE AUDIT AND SPEC DOCUMENTS

The process must create:

```text
CARNO_CONVERSION_AUDIT.md
CARNO_CONVERSION_EXPERIENCE_SPEC.md
```

These are planning and verification artifacts.

They are not optional.

---

# 39. PHASE A — READ-ONLY AUDIT

## IMPORTANT

PHASE A IS READ-ONLY.

Do not implement UI changes.

Do not modify product code.

Do not modify engine code.

Do not modify assets.

Do not refactor.

Do not redesign.

Do not install packages.

Do not change business logic.

Do not change copy in source files.

---

## Phase A objective

Inspect the repository and produce:

```text
CARNO_CONVERSION_AUDIT.md
```

The audit must identify:

### A. Current page structure

* route structure
* landing page components
* visible sections
* Hero
* car experience
* current CTAs
* registration
* trust
* payment
* referral
* footer

### B. Active car rendering path

Confirm the current actual chain.

### C. Protected files

List the files that should not be modified during conversion work.

### D. Existing backend capabilities

Identify:

* auth
* OTP
* waitlist
* rank
* referral
* payment
* analytics

### E. Existing data

Identify whether real sample output is already available.

### F. Product identity

Identify what maker/team information currently exists.

### G. Current payment state

Identify whether payment is:

* live,
* test,
* disabled,
* incomplete,
* or unclear.

### H. Current analytics

Identify existing PostHog events and provider integration.

### I. Current copy

Identify claims that are currently made.

### J. Conversion problems

Identify:

* friction,
* unclear messaging,
* competing CTAs,
* unsupported claims,
* weak product explanation,
* poor mobile experience,
* trust gaps,
* missing status clarity.

### K. Risks

Explicitly list:

* protected engine risk,
* asset risk,
* business logic risk,
* payment risk,
* fabricated-content risk,
* data availability gaps.

---

## Phase A completion condition

After generating:

```text
CARNO_CONVERSION_AUDIT.md
```

STOP.

Do not proceed to Phase B.

Do not proceed to Phase C.

Wait for explicit human approval.

---

# 40. HUMAN REVIEW GATE 1

Human reviews:

```text
CARNO_CONVERSION_AUDIT.md
```

Check:

* Does it correctly understand the current project?
* Does it correctly identify the active car engine?
* Does it distinguish protected files from editable experience files?
* Does it understand the existing backend?
* Does it identify missing real inputs?
* Does it avoid inventing capabilities?
* Does it identify any proposed changes touching the protected engine?

If something is incorrect:

STOP and correct the audit.

Do not proceed to Phase B until explicitly approved.

There is NO implicit approval.

---

# 41. PHASE B — EXPERIENCE SPECIFICATION

Only after explicit human approval of Phase A.

Create:

```text
CARNO_CONVERSION_EXPERIENCE_SPEC.md
```

Phase B is a design/specification stage.

It should define:

### 1. Page narrative

Exact section ordering.

### 2. Hero story

Define:

* copy,
* phase,
* scroll relationship,
* CTA placement,
* status label.

### 3. Sample analysis

Define card structure.

Respect actual available sample data.

### 4. Product explanation

Define the three-step explanation.

### 5. Trust section

Define content architecture.

### 6. Registration

Define OTP/waitlist UX.

### 7. Post-registration state

Define rank/status display.

### 8. Early Access

Define pricing presentation.

### 9. Payment

Define disabled/test-state behavior until policy is finalized.

### 10. Referral

Define experience according to actual backend logic.

### 11. Responsive behavior

Desktop/tablet/mobile.

### 12. Accessibility

Keyboard, reduced motion, contrast, semantic structure.

### 13. Analytics

Meaningful event mapping.

### 14. SEO

Metadata preservation and semantic structure.

### 15. Performance

Do not degrade existing car rendering.

---

# 42. PHASE B CLAIM REVIEW

During Phase B, every customer-facing statement must be classified as:

```text
CONFIRMED
```

or

```text
REQUIRES HUMAN REVIEW
```

Never silently infer confirmation.

A claim based purely on future planned behavior should not be written as an already-established present fact.

For example:

If the product is still preparing for launch, Hero copy may describe the intended launch capability, but the page must clearly communicate:

> **در حال آمادهسازی · لانچ حدود یک ماه دیگر**

Do not make the page look like a currently open public service if it is not.

---

# 43. HUMAN REVIEW GATE 2

After Phase B:

STOP.

Human reviews:

```text
CARNO_CONVERSION_EXPERIENCE_SPEC.md
```

The human must explicitly approve moving to implementation.

There is NO implicit approval.

Do not infer approval from:

* no response,
* elapsed time,
* partial comments,
* file presence,
* previous approval.

Only explicit approval allows Phase C.

---

# 44. PHASE C — IMPLEMENTATION

Only after explicit Phase B approval.

Implement the approved specification.

Priority order:

```text
1. Product clarity
2. Conversion experience
3. Trust
4. Registration
5. Honest urgency
6. Responsive quality
7. Accessibility
8. Analytics
9. Visual polish
```

Do NOT prioritize decorative complexity over product communication.

---

# 45. IMPLEMENTATION SAFETY

During Phase C:

Do not modify:

```text
public/car-frames/v1/**
```

Do not modify protected engine files unless explicitly approved.

Do not modify:

* frame count,
* manifest,
* desktop/mobile asset directories,
* vehicle assets,
* frame mapping,
* memory architecture,
* rendering architecture.

If implementation appears to require changing protected engine/asset files:

STOP.

Report:

1. which file,
2. why it appears necessary,
3. what would change,
4. what safer alternative was considered.

Do not proceed automatically.

---

# 46. VISUAL LAYERING RULE

The text/UI may move around the car.

The car may NOT move because the copy needs more space.

Use:

* z-index,
* local gradients,
* containers,
* max-width,
* spacing,
* positioning,
* responsive text placement.

Do not alter the approved vehicle composition.

---

# 47. CONVERSION UX RULE

Use one primary CTA at a time.

Avoid:

* three competing buttons,
* aggressive popups,
* repeated modal interruptions,
* endless floating CTAs,
* unnecessary forms.

The visitor should always understand:

> "What is the one thing I should do next?"

---

# 48. NO DARK-PATTERN CONVERSION

Do not use:

* fake scarcity,
* fake activity,
* hidden costs,
* misleading labels,
* preselected paid options,
* fake popularity,
* deceptive urgency,
* confusing opt-outs,
* false countdowns.

Conversion should come from understanding value.

---

# 49. REAL DATA RULE

Any value presented as factual must originate from real data.

Examples:

* waitlist position
* registered users
* prices
* market value
* opportunity score
* referral score
* payment status
* launch status

Never fabricate production-looking values.

For visual placeholders during development, make them unmistakably non-production placeholders and never ship them as real content.

---

# 50. TESTING REQUIREMENTS

After implementation:

Run at minimum:

```bash
npx tsc --noEmit
npm run build
```

Also perform practical validation of:

* desktop
* mobile
* RTL
* Hero
* car rotation
* CTA
* registration
* OTP
* status/rank
* disabled payment flow
* responsive layout
* reduced motion
* accessibility basics
* analytics events

Do not claim "production-ready" merely because TypeScript and build pass.

---

# 51. PROTECTED DIFF CHECK

After Phase C, immediately run:

```bash
git diff --stat -- src/features/carno-experience/engine public/car-frames
```

Expected result:

```text
NO CHANGES
```

If there are changes:

STOP.

Do not continue to cleanup.

Do not automatically revert them.

Report exactly what changed.

A human must review the protected diff.

---

# 52. ADDITIONAL PROTECTED FILE CHECK

Also inspect:

```bash
git status --short
git diff -- src/features/carno-experience/engine
git diff -- public/car-frames
```

The goal is to verify that the conversion work stayed outside the frozen rendering system.

---

# 53. FINAL VALIDATION CHECKLIST

Before declaring the work complete, verify:

## Product

* Does the visitor understand what Carno does?
* Is the value obvious?
* Is the messaging benefit-led?
* Is "با عدد، نه با حدس" supported naturally?

## Honesty

* Is pre-launch status clear?
* Are claims verified?
* Are there no fake numbers?
* Are there no fake testimonials?
* Are there no fake users?
* Is urgency truthful?

## Conversion

* Is there one dominant CTA?
* Is registration simple?
* Is rank real?
* Is Early Access understandable?

## Payment

* Is live payment disabled until policy is finalized?
* Is test UX available?
* Is no real transaction processed?

## Trust

* Is real maker/team information used?
* Are contact details real?
* Is privacy/phone usage explained?

## Car

* Is the vehicle unchanged?
* Are all 120 frames intact?
* Is the approved scroll behavior intact?
* Are production assets unchanged?

## Engineering

* TypeScript passes.
* Production build passes.
* No unnecessary dependencies added.
* No redundant backend implementation introduced.

## Mobile

* No layout breakage.
* No horizontal overflow.
* CTA remains usable.
* Text remains readable.
* Car remains visually correct.

## Accessibility

* Keyboard works.
* Focus states work.
* Reduced motion works.
* Semantic structure remains sound.

## Analytics

* Meaningful events work.
* No render-loop analytics.

---

# 54. GIT FINAL CHECK

At the end:

```bash
git status --short
git diff --stat
```

Review every changed file.

Group changes conceptually into:

```text
Conversion/UI
Content
Analytics
Auth/Waitlist integration
Payment UX
Other
```

Anything outside the approved scope must be reported.

---

# 55. FINAL REPORT FORMAT

After implementation and validation, report:

## Changed

Exact files changed and why.

## Product Experience

What changed in the user journey.

## Conversion

What changed in CTA and registration flow.

## Trust

What was added/changed.

## Payment

Current state:

* disabled,
* test,
* or live

and why.

## Analytics

Events added/changed.

## Validation

Actual results of:

```bash
npx tsc --noEmit
npm run build
```

## Protected Engine

Result of:

```bash
git diff --stat -- src/features/carno-experience/engine public/car-frames
```

Must explicitly state whether it is empty.

## Remaining PENDING Inputs

List anything still awaiting human data or product decision.

Do not hide unresolved issues.

---

# 56. ABSOLUTE PROHIBITIONS

Never:

* fabricate data,
* fabricate testimonials,
* fabricate users,
* fabricate rankings,
* fabricate market prices,
* fabricate opportunity scores,
* fabricate social proof,
* fabricate team identity,
* fabricate partnerships,
* fabricate awards,
* fabricate launch dates,
* fabricate scarcity,
* enable live payment prematurely,
* silently modify business rules,
* silently modify engine behavior,
* silently modify car assets,
* silently add dependencies,
* silently replace the rendering engine,
* silently change product positioning,
* silently weaken requirements.

---

# 57. STOP CONDITIONS

STOP immediately when:

### STOP CONDITION A

The requested change appears to require editing protected engine or car asset files.

### STOP CONDITION B

A customer-facing claim cannot be verified.

Mark it for human review instead of inventing it.

### STOP CONDITION C

Real sample output is unavailable but implementation requires actual sample values.

### STOP CONDITION D

Real maker/team identity is unavailable for content that is supposed to be presented as real.

### STOP CONDITION E

Refund/cancellation policy is missing but live payment activation is being considered.

### STOP CONDITION F

Existing backend business logic conflicts with the planned frontend experience.

### STOP CONDITION G

A human approval gate has not been explicitly passed.

### STOP CONDITION H

A requested change could alter the approved 120-frame car experience.

---

# 58. IMPLEMENTATION PHILOSOPHY

Think of Carno as:

> a premium automotive decision experience

not:

> an AI SaaS template.

The car is the visual protagonist.

The user's problem is the narrative protagonist.

The product value is the commercial protagonist.

Technology should remain largely invisible unless it directly helps explain product trust.

The visitor should leave with this mental model:

> "Carno helps me understand whether a car is actually worth pursuing, before I waste time or make a bad purchase decision."

And the emotional takeaway should be:

> **با عدد، نه با حدس.**

---

# 59. FIRST ACTION — MANDATORY

After reading this entire file:

DO NOT implement anything.

DO NOT modify source files.

DO NOT install dependencies.

DO NOT proceed to Phase B.

DO NOT proceed to Phase C.

Execute ONLY:

## PHASE A — READ-ONLY AUDIT

Create:

```text
CARNO_CONVERSION_AUDIT.md
```

Then STOP.

Wait for explicit human approval.

No implicit approval.

No automatic continuation.
