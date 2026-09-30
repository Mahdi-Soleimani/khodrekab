'use client';
import React, { useState, useTransition, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useRouter } from 'next/navigation';
import posthog from 'posthog-js';
import { sendOtpAction, verifyOtpAction } from '@/app/actions/auth';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function WaitlistForm() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const router = useRouter();
  
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      gsap.registerPlugin(ScrollTrigger);
    }
    
    if (contentRef.current && sectionRef.current) {
      gsap.fromTo(contentRef.current, 
        { opacity: 0, y: 50 },
        { 
          opacity: 1, 
          y: 0, 
          duration: 1, 
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 75%",
          }
        }
      );
    }
  }, []);

  const handlePhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    posthog.capture('phone_submitted');
    
    startTransition(async () => {
      const res = await sendOtpAction(phone);
      if (!res.success) {
        setError(res.error || 'خطایی رخ داد');
      } else {
        posthog.capture('otp_sent');
        setStep('otp');
      }
    });
  };

  const handleOtpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const urlParams = new URLSearchParams(window.location.search);
    const referredByCode = urlParams.get('ref');
    const source = urlParams.get('utm_source');

    startTransition(async () => {
      const res = await verifyOtpAction(phone, otp, referredByCode, source);
      if (!res.success) {
        setError(res.error || 'کد اشتباه است یا منقضی شده.');
      } else {
        posthog.capture('otp_verified');
        posthog.capture('waitlist_joined');
        if (referredByCode) posthog.capture('referral_signup');
        router.push('/waitlist');
      }
    });
  };

  return (
    <section ref={sectionRef} className="w-full py-32 px-6 relative bg-white" id="waitlist">
      <div ref={contentRef} className="max-w-xl mx-auto flex flex-col items-center relative z-10 opacity-0">
        
        {/* Editorial headline — story continuation, not a generic "signup" */}
        <div className="text-center mb-16">
          <div className="w-8 h-[2px] bg-[#E31C3D] mx-auto mb-8" />
          <h2 className="text-3xl md:text-5xl font-black text-[#111111] tracking-tight leading-tight mb-4">
            اولین نسخه کارنو از همینجا شروع میشود.
          </h2>
          <p className="text-base md:text-lg text-[#666666] leading-relaxed max-w-md mx-auto">
            به جمع محدود کاربران اولیه بپیوندید و بازار خودرو را شفاف تجربه کنید.
          </p>
        </div>

        {step === 'phone' ? (
          <form onSubmit={handlePhoneSubmit} className="w-full max-w-sm flex flex-col gap-5">
            <Input 
              placeholder="شماره موبایل (مثال: 09123456789)"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (e.target.value.length === 2) posthog.capture('phone_input_started');
              }}
              fullWidth
              dir="ltr"
              className="text-left bg-[#FAFAFA] border-[#E5E5E5] text-[#111111] placeholder:text-[#CCCCCC] focus:border-[#E31C3D] focus:ring-[#E31C3D]/10 h-14 text-base transition-all"
              disabled={isPending}
              required
              type="tel"
              inputMode="numeric"
              pattern="09[0-9]{9}"
            />
            {error && <p className="text-[#E31C3D] text-sm font-medium">{error}</p>}
            <Button type="submit" size="lg" fullWidth disabled={isPending}>
              {isPending ? 'در حال ارتباط...' : 'دریافت دسترسی اولیه'}
            </Button>
            
            {/* Subtle social proof — minimal */}
            <p className="text-center text-xs text-[#999999] mt-4">
              ظرفیت نسخه اولیه محدود است
            </p>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="w-full max-w-sm flex flex-col gap-5">
            <div className="text-center mb-4 text-[#666666] text-sm">
              کد ارسال شده به <span className="font-bold text-[#111111]">{phone}</span> را وارد کنید
              <button type="button" onClick={() => setStep('phone')} className="block text-[#E31C3D] hover:text-[#C41834] transition-colors mx-auto mt-2 text-sm font-medium">
                ویرایش شماره
              </button>
            </div>
            <Input 
              placeholder="کد تایید"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              fullWidth
              dir="ltr"
              className="text-center tracking-[0.5em] text-3xl font-black bg-[#FAFAFA] border-[#E5E5E5] text-[#111111] placeholder:text-[#DDDDDD] focus:border-[#E31C3D] focus:ring-[#E31C3D]/10 h-16 transition-all"
              disabled={isPending}
              required
              maxLength={5}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
            />
            {error && <p className="text-[#E31C3D] text-sm font-medium">{error}</p>}
            <Button type="submit" size="lg" fullWidth disabled={isPending}>
              {isPending ? 'در حال بررسی...' : 'تایید شماره'}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
