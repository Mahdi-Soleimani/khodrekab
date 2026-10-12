'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CarnoAnalytics } from '../hooks/useCarnoExperience';

interface WaitlistStatusData {
  rank: number;
  refCode: string;
  referralCount: number;
  status: string;
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256PureJs(ascii: string): string {
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  for (let i = 0; i < ascii.length; i++) {
    words[i >> 2] |= ascii.charCodeAt(i) << ((3 - (i % 4)) * 8);
  }
  words[asciiBitLength >> 5] |= 0x80 << (24 - (asciiBitLength % 32));
  words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

  for (let i = 0; i < words.length; i += 16) {
    const w = words.slice(i, i + 16);
    for (let j = 0; j < 16; j++) if (w[j] === undefined) w[j] = 0;
    let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7];

    for (let j = 0; j < 64; j++) {
      if (j >= 16) {
        const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      const ch = (e & f) ^ (~e & g);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp1 = (h + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ch + k[j] + w[j]) | 0;
      const temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  let result = '';
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      const byte = (hash[i] >> (8 * j)) & 255;
      result += (byte < 16 ? '0' : '') + byte.toString(16);
    }
  }
  return result;
}

async function solvePoWClient(challenge: string, difficulty: number): Promise<string> {
  const targetPrefix = '0'.repeat(difficulty);
  const hasSubtle = typeof window !== 'undefined' && !!(window.crypto?.subtle?.digest);

  // 1. Try native Web Crypto API first (fastest in HTTPS / modern browsers)
  if (hasSubtle) {
    try {
      const encoder = new TextEncoder();
      let candidate = 0;
      while (candidate < 500000) {
        const candidateStr = candidate.toString();
        const data = encoder.encode(`${challenge}:${candidateStr}`);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        if (hashHex.startsWith(targetPrefix)) {
          return candidateStr;
        }
        candidate++;
      }
    } catch {}
  }

  // 2. Pure JS fallback for HTTP, webviews, and environments where crypto.subtle is restricted
  try {
    let candidate = 0;
    while (candidate < 500000) {
      const candidateStr = candidate.toString();
      const hashHex = sha256PureJs(`${challenge}:${candidateStr}`);
      if (hashHex.startsWith(targetPrefix)) {
        return candidateStr;
      }
      candidate++;
    }
  } catch {}

  return '0';
}

export function WaitlistSection() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'otp' | 'verified' | 'transition'>('phone');
  const [successGreeting, setSuccessGreeting] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusData, setStatusData] = useState<WaitlistStatusData | null>(null);
  const [copied, setCopied] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [honeypot, setHoneypot] = useState('');
  const mountTimeRef = useRef<number>(0);

  useEffect(() => {
    mountTimeRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

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

  const handlePhoneSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');

    const cleanPhone = phone.trim();
    if (!cleanPhone) {
      setError('لطفاً شماره موبایل را وارد کنید.');
      return;
    }

    setLoading(true);
    CarnoAnalytics.track('registration_started', { source: 'waitlist_section' });

    try {
      let powPayload: { challenge: string; solution: string } | undefined;
      try {
        const chalRes = await fetch('/api/waitlist/challenge');
        if (chalRes.ok) {
          const { challenge, difficulty } = await chalRes.json();
          const solution = await solvePoWClient(challenge, difficulty || 3);
          powPayload = { challenge, solution };
        }
      } catch {}

      const fillTimeMs = Date.now() - mountTimeRef.current;

      const res = await fetch('/api/waitlist/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          pow: powPayload,
          _hp: honeypot,
          fillTimeMs,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'خطایی در ارسال کد رخ داد.');
      } else {
        setMaskedPhone(data.maskedPhone || '');
        setCooldown(data.cooldownSeconds || 60);
        setStep('otp');
      }
    } catch {
      setError('خطا در ارتباط با سرور. لطفاً مجدداً تلاش کنید.');
    } finally {
      setLoading(false);
    }
  }, [phone, honeypot]);

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
        CarnoAnalytics.track('otp_verified');
        const greeting = data.isNewUser ? 'به Carno خوش آمدی 👋' : 'خوش آمدی دوباره 👋';
        setSuccessGreeting(greeting);
        setStep('transition');
        setTimeout(() => {
          router.push('/dashboard');
        }, 1200);
      }
    } catch {
      setError('خطا در بررسی کد. لطفاً دوباره تلاش کنید.');
    } finally {
      setLoading(false);
    }
  }, [otp, phone]);

  const copyReferralLink = useCallback(() => {
    if (!statusData?.refCode) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    const link = `${baseUrl}/?ref=${statusData.refCode}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
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
              <input
                type="text"
                name="_hp"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                style={{ display: 'none' }}
                aria-hidden="true"
              />
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
              <span className="font-mono text-white font-bold" dir="ltr">{maskedPhone || phone}</span>
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
                placeholder="• • • • •"
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

              <div className="flex flex-col items-center gap-2 mt-4 text-xs text-slate-400">
                {cooldown > 0 ? (
                  <span>ارسال مجدد کد تا {cooldown} ثانیه دیگر</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handlePhoneSubmit()}
                    disabled={loading}
                    className="text-[#E31C4E] hover:underline cursor-pointer font-medium"
                  >
                    ارسال مجدد کد
                  </button>
                )}
                <span className="text-[11px] text-slate-500">
                  اگر شماره درست باشد، کد ارسال می‌شود. دریافت پیامک ممکن است تا ۲ دقیقه زمان ببرد.
                </span>
              </div>
            </form>
          </div>
        )}

        {step === 'transition' && (
          <div className="w-full flex flex-col items-center text-center py-10">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-3xl mb-4">
              ✓
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">
              {successGreeting}
            </h2>
            <p className="text-sm text-slate-400 flex items-center justify-center gap-2 mt-2">
              <span className="w-2 h-2 rounded-full bg-[#E31C4E] animate-ping" />
              <span>در حال انتقال به داشبورد کارنو...</span>
            </p>
          </div>
        )}

        {step === 'verified' && (
          <div className="w-full flex flex-col items-center text-center">
            
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-2xl mb-4">
              ✓
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">
              شما وارد حساب کارنو شده‌اید.
            </h2>
            <p className="text-sm text-slate-400 mb-6">
              جایگاه شما در صف کاربران اولیه کارنو ثبت شده است.
            </p>

            <a
              href="/dashboard"
              className="w-full max-w-sm h-14 bg-[#E31C4E] hover:bg-[#C21641] text-white font-bold text-base rounded-2xl transition-all duration-200 shadow-lg shadow-[#E31C4E]/25 hover:shadow-[#E31C4E]/40 active:scale-95 flex items-center justify-center gap-2 mb-8 cursor-pointer"
            >
              <span>ورود به داشبورد کارنو</span>
              <span>←</span>
            </a>

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
                    value={`${process.env.NEXT_PUBLIC_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '')}/?ref=${statusData.refCode}`}
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
