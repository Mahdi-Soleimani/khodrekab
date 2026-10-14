'use client';

import React from 'react';
import { CinematicNav } from '@/components/cinematic/CinematicNav';
import { KhodrekabExperience } from '../components/KhodrekabExperience';
import { ProblemSection } from '../sections/ProblemSection';
import { SampleAnalysisSection } from '../sections/SampleAnalysisSection';
import { ThreeStepSection } from '../sections/ThreeStepSection';
import { TrustSection } from '../sections/TrustSection';
import { WaitlistSection } from '../sections/WaitlistSection';
import { EarlyAccessSection } from '../sections/EarlyAccessSection';
import { FAQSection } from '../sections/FAQSection';
import { FooterSection } from '../sections/FooterSection';

export function ProductLandingPage() {
  return (
    <main 
      dir="rtl"
      className="flex flex-col min-h-screen bg-[#050814] text-white selection:bg-[#E31C4E] selection:text-white" 
      itemScope 
      itemType="https://schema.org/Product"
    >
      <meta itemProp="name" content="خودرکاب | سامانه تحلیل و ارزیابی هوشمند خودرو" />
      <meta itemProp="description" content="خودرکاب؛ تحلیل هوشمند بازار خودرو و کشف فرصت‌های زیر قیمت بازار. با عدد، نه با حدس." />
      
      {/* 1. Cinematic Navigation */}
      <header>
        <CinematicNav />
      </header>

      {/* 2. Hero Car Experience (Scroll Engine + Interactive 120-frame Canvas + Story + CTA) */}
      <KhodrekabExperience />

      {/* 3. Problem Section (بزرگترین اشتباه هنگام خرید خودرو چیست؟) */}
      <ProblemSection />

      {/* 4. Sample Analysis Section (نمونه تحلیل خودرکاب با برچسب نمونه نمایشی) */}
      <SampleAnalysisSection />

      {/* 5. Three-Step Explanation (نحوه کارکرد خودرکاب در سه گام ساده) */}
      <ThreeStepSection />

      {/* 6. Trust Layer (هویت تیم جی‌هاب، مرحله محصول، حریم خصوصی شماره همراه) */}
      <TrustSection />

      {/* 7. Waitlist Registration (ثبت‌نام شماره همراه + OTP واقعی + نمایش رتبه حقیقی) */}
      <WaitlistSection />

      {/* 8. Early Access (دسترسی نسل اول + پیش‌نمایش تست پرداخت بدون تراکنش مالی) */}
      <EarlyAccessSection />

      {/* 9. FAQ Section (سوالات متداول پیرامون کارکرد و شفافیت) */}
      <FAQSection />

      {/* 10. Footer Section (فوتر برند، کپی‌رایت جی‌هاب و راه‌های تماس) */}
      <FooterSection />
    </main>
  );
}

