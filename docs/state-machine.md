# Khodrekab State Machine Architecture

This document formalizes the finite state machines (FSM) governing interactive car scrubbing, progressive asset hydration, user onboarding, and payment processing in **Khodrekab**.

---

## 1. Interactive 360-Degree Scroller State Machine

The landing page experience synchronizes user scroll position with an HTML5 Canvas rendering a 120-frame WebP rotation sequence divided into 6 distinct narrative scenes.

```mermaid
stateDiagram-v2
    [*] --> Scene1_Hero: Scroll Progress 0.00 - 0.16
    Scene1_Hero --> Scene2_Wheels: Scroll Progress 0.16 - 0.35
    Scene2_Wheels --> Scene3_Aero: Scroll Progress 0.35 - 0.55
    Scene3_Aero --> Scene4_Rear: Scroll Progress 0.55 - 0.72
    Scene4_Rear --> Scene5_Cabin: Scroll Progress 0.72 - 0.88
    Scene5_Cabin --> Scene6_CTA: Scroll Progress 0.88 - 1.00

    state Scene1_Hero {
        Frame_001_to_020: Front 3/4 Dynamic Profile
        Copy1: "خرید و فروش شفاف خودرو"
    }
    state Scene2_Wheels {
        Frame_021_to_042: Side Profile & Diamond Wheels
        Copy2: "کارشناسی تخصصی و تضمین سلامت شاسی"
    }
    state Scene3_Aero {
        Frame_043_to_065: Aerodynamic Roofline & Windshield
        Copy3: "ارزیابی بیش از ۴۰۰ نقطه فنی و بدنه"
    }
    state Scene4_Rear {
        Frame_066_to_086: Aggressive Rear Diffuser & Lighting
        Copy4: "ضمانت بازگشت وجه در صورت مغایرت"
    }
    state Scene5_Cabin {
        Frame_087_to_105: Interior Cockpit & Leather
        Copy5: "تجربه رانندگی ایمن و تایید اصالت سند"
    }
    state Scene6_CTA {
        Frame_106_to_120: Final Hero Stance
        Copy6: "ثبت‌نام زودهنگام در باشگاه خودرکاب"
    }
```

---

## 2. Progressive Frame Loading State Machine

To guarantee instantaneous responsiveness on weak cellular networks (3G/4G), the frame loader operates as an autonomous state machine:

```mermaid
stateDiagram-v2
    [*] --> SSR_POSTER: Server renders eager Frame 1 <img>
    SSR_POSTER --> LOADING_ANCHORS: Client mounts, requests 5 Keyframes (1, 30, 60, 90, 120)
    LOADING_ANCHORS --> ANCHORS_READY: 5 Anchors decoded in memory (Canvas becomes interactive)
    
    ANCHORS_READY --> STRIDE_4: Ingest frames at interval of 4
    STRIDE_4 --> STRIDE_2: Ingest intermediate frames at interval of 2
    STRIDE_2 --> COMPLETE: All 120 frames in memory (100% fidelity)

    ANCHORS_READY --> DEGRADED_MODE: Memory Warning / Low Memory Device (<128MB budget)
    DEGRADED_MODE --> ANCHORS_READY: Purge intermediate frames; retain only 30 anchor frames
```

### Transition Guard Rules:
- **`SSR_POSTER` $\to$ `ANCHORS_READY`:** Must complete within 800ms on 4G. If network times out, nearest cached frame is displayed.
- **Interpolation Fallback:** While intermediate frames are downloading, the canvas engine automatically maps any scroll position to the nearest available frame index via `O(1)` binary lookup (`findNearestLoadedFrame`).

---

## 3. User Onboarding & OTP State Machine

Governs user authentication, Proof-of-Work verification, and waitlist registration:

```mermaid
stateDiagram-v2
    [*] --> UNREGISTERED
    UNREGISTERED --> SOLVING_POW: User enters phone number
    SOLVING_POW --> POW_VERIFIED: WebWorker computes valid challenge solution
    SOLVING_POW --> UNREGISTERED: PoW Timeout or Invalid Signature

    POW_VERIFIED --> OTP_DISPATCHED: Server queues SMS via Redis / MeliPayamak
    OTP_DISPATCHED --> OTP_LOCKED: 10 consecutive failed attempts (30 min lockout)
    OTP_DISPATCHED --> OTP_EXPIRED: 120 seconds elapsed without entry
    OTP_EXPIRED --> SOLVING_POW: User requests new OTP

    OTP_DISPATCHED --> AUTHENTICATED: Valid 5-digit OTP submitted
    AUTHENTICATED --> WAITLISTED: WaitlistEntry created (Base score: 10)
    AUTHENTICATED --> EARLY_ACCESS_PENDING: User initiates reservation payment
```

---

## 4. Payment Intent Lifecycle State Machine

Khodrekab implements a high-reliability card-to-card and gateway payment reconciliation machine:

```mermaid
stateDiagram-v2
    [*] --> INTENT_CREATED: User clicks Reserve (Total = 299,000 + Unique Code)
    INTENT_CREATED --> COUNTDOWN_ACTIVE: 15-Minute Timer starts in UI

    COUNTDOWN_ACTIVE --> SMS_WEBHOOK_RECEIVED: Bank sends transaction SMS to n8n
    SMS_WEBHOOK_RECEIVED --> VERIFYING: Matches totalAmount + status == PENDING
    VERIFYING --> PAID: Transaction confirmed atomically; User status -> EARLY_ACCESS

    COUNTDOWN_ACTIVE --> EXPIRED: 15 minutes elapsed without matching transaction
    EXPIRED --> INTENT_CREATED: User generates fresh intent

    VERIFYING --> FAILED: Amount mismatch or invalid reference
    PAID --> REFUNDED: Admin initiates manual refund
```

### State Definitions & Persistence:
- **`INTENT_CREATED`:** Generates unique integer offset between `1` and `999` to distinguish concurrent deposits.
- **`COUNTDOWN_ACTIVE`:** UI maintains countdown with auto-polling every 5 seconds.
- **`PAID`:** Terminal state. Grants immediate access to the authenticated user dashboard and triggers a congratulatory SMS.
