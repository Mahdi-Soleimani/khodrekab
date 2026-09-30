# Story Map Data Contract

Translating the psychological narrative into a strict TypeScript interface. This structure ensures UI components can blindly map properties to DOM elements without containing storytelling logic.

## Type Definition

```typescript
export type StoryPhaseId = 'ENTRY' | 'DISCOVERY' | 'INSPECTION' | 'RISK_REVEAL' | 'SOLUTION' | 'CTA_COMPLETE';

export interface StoryPhase {
  id: StoryPhaseId;
  progressRange: [number, number]; // e.g., [0.0, 0.25]
  frameRange: [number, number]; // e.g., [1, 30]
  content: {
    headline: string;
    description: string;
  };
  uiBehavior: {
    lightingClass: string; // Used to trigger CSS background/glow changes
    textAnimation: 'fade-up' | 'scale-in' | 'static';
  };
  analyticsEvent: string; // The event to fire when entering this phase
  conversionPayload?: {
    showTrustLayer: boolean; // Enables "Why Carno?", "Value Proposition" blocks
    trustPoints?: string[];
    primaryCtaText?: string;
    secondaryCtaText?: string;
  };
}
```

## Contract Instances

```typescript
export const CarnoPhases: StoryPhase[] = [
  {
    id: 'ENTRY',
    progressRange: [0, 0.1],
    frameRange: [1, 1],
    content: { 
      headline: "هوشمندی قبل از انتخاب", 
      description: "تجربه بررسی خودرو با دقت میلی‌متری." 
    },
    uiBehavior: { lightingClass: 'bg-hero-glow', textAnimation: 'fade-up' },
    analyticsEvent: 'car_story_phase_reached',
    conversionPayload: { showTrustLayer: false }
  },
  {
    id: 'RISK_REVEAL',
    progressRange: [0.5, 0.75],
    frameRange: [60, 90],
    content: { 
      headline: "چیزی که دیگران نمی‌بینند، می‌تواند تفاوت اصلی باشد", 
      description: "پشت پرده سلامت خودرو با پلتفرم ارزیابی Carno." 
    },
    uiBehavior: { lightingClass: 'bg-risk-gradient', textAnimation: 'fade-up' },
    analyticsEvent: 'car_story_phase_reached',
    conversionPayload: { showTrustLayer: false }
  },
  {
    id: 'SOLUTION',
    progressRange: [0.75, 1.0],
    frameRange: [90, 120],
    content: { 
      headline: "یک انتخاب مطمئن", 
      description: "با Carno همیشه یک قدم جلوتر از بازار حرکت کنید." 
    },
    uiBehavior: { lightingClass: 'bg-solution-gradient', textAnimation: 'scale-in' },
    analyticsEvent: 'car_story_phase_reached',
    conversionPayload: { 
      showTrustLayer: true,
      trustPoints: ["بررسی ۵۰۰ نقطه حیاتی", "تحلیل قیمت با هوش مصنوعی", "گزارش شفاف و قطعی"],
      primaryCtaText: "رزرو جایگاه",
      secondaryCtaText: "دریافت اطلاع‌رسانی لانچ"
    }
  }
];
```
