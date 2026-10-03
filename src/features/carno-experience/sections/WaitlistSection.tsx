'use client';

import React, { useState, useEffect, useCallback } from 'react';
import posthog from 'posthog-js';
import { CarnoAnalytics } from '../hooks/useCarnoExperience';

interface WaitlistStatusData {
  rank: number;
  refCode: string;
  referralCount: number;
  status: string;
}

export function WaitlistSection() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp' | 'verified'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusData, setStatusData] = useState<WaitlistStatusData | null>(null);
  const [copied, setCopied] = useState(false);

  // Check if user is already verified on mount
  useEffect(() => {
    fetch('/api/waitlist/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setStatusData(data.data);
          setStep('verified');
          CarnoAnalytics.track('waitlist_position_viewed', { rank: data.data.rank });
        }
      })
      .catch(() => {
        // Not logged in or no waitlist entry, stay on phone step
      });
  }, []);

  const handlePhoneSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanPhone = phone.trim();
    if (!/^09\d{9}$/.test(cleanPhone)) {
      setError('لطفاً شماره موبایل معتبر ۱۱ رقمی با ۰۹ وارد کنید.');
      return;
    }

    setLoading(true);
    posthog.capture('phone_submitted', { source: 'waitlist_section' });
    CarnoAnalytics.track('registration_started', { source: 'waitlist_section' });

    try {
      const res = await fetch('/api/waitlist/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'خطایی در ارسال کد رخ داد.');
      } else {
        posthog.capture('otp_sent');
        setStep('otp');
      }
    } catch {
      setError('خطا در ارتباط با سرور. لطفاً مجدداً تلاش کنید.');
    } finally {
      setLoading(false);
    }
  }, [phone]);

  const handleOtpSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanOtp = otp.trim();
    if (!cleanOtp) {
      setError('لطفاً کد تایید را وارد کنید.');
      return;
    }

    setLoading(true);

    const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const referredByCode = urlParams?.get('ref') || undefined;
    const source = urlParams?.get('utm_source') || 'direct';

    try {
      const res = await fetch('/api/waitlist/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim(),
          otp: cleanOtp,
          referredByCode,
          source,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'کد وارد شده اشتباه یا منقضی شده است.');
      } else {
        posthog.capture('otp_verified');
        CarnoAnalytics.track('otp_verified');

        // Fetch real status
        const statusRes = await fetch('/api/waitlist/status');
        const statusJson = await statusRes.json();
        if (statusJson.success && statusJson.data) {
          setStatusData(statusJson.data);
          CarnoAnalytics.track('waitlist_position_viewed', { rank: statusJson.data.rank });
        }
        setStep('verified');
      }
    } catch {
      setError('خطا در بررسی کد. لطفاً دوباره تلاش کنید.');
    } finally {
      setLoading(false);
    }
  }, [otp, phone]);

  const copyReferralLink = useCallback(() => {
    if (!statusData?.refCode) return;
    const link = `https://carno.app/?ref=${statusData.refCode}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      posthog.capture('referral_link_copied');
      CarnoAnalytics.track('referral_shared', { refCode: statusData.refCode });
      setTimeout(() => setCopied(false), 3000);
    });
  }, [statusData]);

  const scrollToEarlyAccess = useCallback(() => {
    document.getElementById('early-access')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <section 
      id="waitlist-registration"
      className="w-full py-28 px-6 bg-[#050814] text-white border-t border-slate-800/80 relative z-20"
      aria-labelledby="waitlist-heading"
    >
      <div className="max-w-xl mx-auto flex flex-col items-center">
        
        {/* Accent Red Line */}
        <div className="w-10 h-1 bg-[#E31C4E] rounded-full mb-6" />

        {step === 'phone' && (
          <div className="w-full flex flex-col items-center text-center">
            <h2 
              id="waitlist-heading"
              className="text-2xl sm:text-4xl font-black text-white tracking-tight mb-4 leading-tight"
            >
              برای دریافت دسترسی اولیه، جایگاهت را ثبت کن.
            </h2>
            <p className="text-sm sm:text-base text-slate-400 mb-10 max-w-md leading-relaxed">
              ثبت‌نام اولیه رایگان است. پس از وارد کردن شماره، کد تأیید پیامک می‌شود.
            </p>

            <form onSubmit={handlePhoneSubmit} className="w-full max-w-md flex flex-col gap-4">
              <div className="flex flex-col gap-2 text-right">
                <label htmlFor="phone-input" className="text-xs font-medium text-slate-300 pr-1">
                  شماره موبایل
                </label>
                <input
                  id="phone-input"
                  type="tel"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="09123456789"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={loading}
                  maxLength={11}
                  required
                  className="w-full h-14 px-4 bg-[#0B1124] border border-slate-700 focus:border-[#E31C4E] focus:ring-1 focus:ring-[#E31C4E] rounded-2xl text-left font-mono text-lg text-white placeholder:text-slate-500 transition-all outline-none"
                />
              </div>

              {error && (
                <p className="text-xs sm:text-sm text-red-400 text-right bg-red-950/40 border border-red-800/60 p-3 rounded-xl">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-14 bg-[#E31C4E] hover:bg-[#C21641] disabled:opacity-60 text-white font-bold text-base rounded-2xl transition-all duration-200 shadow-lg shadow-[#E31C4E]/25 hover:shadow-[#E31C4E]/40 active:scale-95 cursor-pointer mt-2"
              >
                {loading ? 'در حال ارسال کد...' : 'دریافت کد دسترسی'}
              </button>

              <p className="text-xs text-slate-400 mt-2">
                ثبت‌نام اولیه رایگان · بدون پیامک‌های تبلیغاتی
              </p>
            </form>
          </div>
        )}

        {step === 'otp' && (
          <div className="w-full flex flex-col items-center text-center">
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">
              کد دسترسی را وارد کن
            </h2>
            <div className="text-sm text-slate-400 mb-8 flex items-center gap-2">
              <span>کد ارسال‌شده به</span>
              <span className="font-mono text-white font-bold" dir="ltr">{phone}</span>
              <button
                type="button"
                onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
                className="text-xs text-[#E31C4E] hover:underline cursor-pointer mr-1"
              >
                (ویرایش شماره)
              </button>
            </div>

            <form onSubmit={handleOtpSubmit} className="w-full max-w-sm flex flex-col gap-4">
              <input
                id="otp-input"
                type="tel"
                dir="ltr"
                inputMode="numeric"
                autoFocus
                placeholder="• • • •"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                disabled={loading}
                maxLength={6}
                required
                className="w-full h-16 bg-[#0B1124] border border-slate-700 focus:border-[#E31C4E] focus:ring-1 focus:ring-[#E31C4E] rounded-2xl text-center font-mono text-3xl font-black tracking-[0.5em] text-white placeholder:text-slate-600 transition-all outline-none"
              />

              {error && (
                <p className="text-xs sm:text-sm text-red-400 text-right bg-red-950/40 border border-red-800/60 p-3 rounded-xl">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-14 bg-[#E31C4E] hover:bg-[#C21641] disabled:opacity-60 text-white font-bold text-base rounded-2xl transition-all duration-200 shadow-lg shadow-[#E31C4E]/25 hover:shadow-[#E31C4E]/40 active:scale-95 cursor-pointer mt-2"
              >
                {loading ? 'در حال بررسی کد...' : 'تأیید و ثبت جایگاه'}
              </button>
            </form>
          </div>
        )}

        {step === 'verified' && (
          <div className="w-full flex flex-col items-center text-center">
            
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-2xl mb-4">
              ✓
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">
              ثبت‌نامت با موفقیت انجام شد.
            </h2>
            <p className="text-sm text-slate-400 mb-8">
              جایگاه تو در صف کاربران اولیه کارنو ثبت شد.
            </p>

            {/* REAL POSITION CARD */}
            <div className="w-full bg-[#0B1124] border border-slate-700/80 rounded-3xl p-6 sm:p-8 flex flex-col items-center shadow-xl mb-8">
              <span className="text-xs sm:text-sm text-slate-400 font-medium mb-3">
                جایگاه فعلی تو در صف دسترسی اولیه:
              </span>
              
              <div className="text-5xl sm:text-6xl font-black text-white tabular-nums tracking-tight font-mono my-2 text-emerald-400">
                #{statusData?.rank ?? '...'}
              </div>

              <div className="mt-4 px-4 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
                در حال تشکیل اولین گروه کاربران Carno
              </div>

              <p className="text-xs text-slate-400 mt-4 leading-relaxed max-w-sm">
                به‌محض آماده‌سازی زیرساخت، دعوت‌نامه ورود بر اساس همین اولویت برای شماره همراهت ارسال خواهد شد.
              </p>
            </div>

            {/* REFERRAL LINK BOX */}
            {statusData?.refCode && (
              <div className="w-full bg-[#111830] border border-slate-800 rounded-2xl p-6 flex flex-col gap-4 text-right mb-8">
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">
                    با دعوت از دوستان، اولویت دسترسی خودت را بهتر کن.
                  </h3>
                  <p className="text-xs text-slate-400">
                    به ازای هر نفری که با لینک اختصاصی تو ثبت‌نام کند، ۵۰ رتبه اولویت دسترسی‌ات افزایش می‌یابد.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 mt-1">
                  <input
                    readOnly
                    dir="ltr"
                    value={`https://carno.app/?ref=${statusData.refCode}`}
                    className="flex-1 px-4 py-3 bg-[#050814] border border-slate-700 rounded-xl text-xs text-slate-300 font-mono text-left outline-none"
                  />
                  <button
                    type="button"
                    onClick={copyReferralLink}
                    className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-colors shrink-0 cursor-pointer"
                  >
                    {copied ? 'کپی شد! ✓' : 'کپی لینک'}
                  </button>
                </div>

                {statusData.referralCount > 0 && (
                  <p className="text-xs text-emerald-400 font-medium">
                    تعداد دوستان دعوت‌شده: {statusData.referralCount} نفر
                  </p>
                )}
              </div>
            )}

            {/* Link to Early Access Pass */}
            <button
              onClick={scrollToEarlyAccess}
              className="text-xs sm:text-sm text-slate-400 hover:text-white underline underline-offset-4 cursor-pointer transition-colors"
            >
              می‌خواهی بدون نوبت وارد شوی؟ بررسی شرایط دسترسی نسل اول ↓
            </button>

          </div>
        )}

      </div>
    </section>
  );
}
