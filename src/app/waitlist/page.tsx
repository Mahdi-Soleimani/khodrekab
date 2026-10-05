'use client';
import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useRouter } from 'next/navigation';
import posthog from 'posthog-js';

export default function WaitlistPage() {
  const [rank, setRank] = useState<number | null>(null);
  const [refCode, setRefCode] = useState('');
  const [status, setStatus] = useState('WAITLIST');
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/waitlist/status')
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          router.push('/');
        } else {
          setRank(data.data.rank);
          setRefCode(data.data.refCode);
          setStatus(data.data.status);
          posthog.capture('waitlist_dashboard_viewed', { rank: data.data.rank, status: data.data.status });
          if (data.data.status === 'WAITLIST') {
            posthog.capture('early_access_view');
          }
        }
      })
      .catch(() => router.push('/'))
      .finally(() => setLoading(false));
  }, [router]);

  const handleEarlyAccess = async () => {
    setPaymentLoading(true);
    posthog.capture('payment_started');
    try {
      const res = await fetch('/api/payment/intent', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        // Save intent details to local storage or state management for the payment page to read, or pass via URL
        localStorage.setItem('paymentIntent', JSON.stringify(data.data));
        router.push('/payment');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPaymentLoading(false);
    }
  };

  const copyLink = () => {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    navigator.clipboard.writeText(`${baseUrl}/?ref=${refCode}`);
    alert('لینک کپی شد!');
  };

  if (loading) return <div className="flex justify-center py-20">در حال بارگذاری...</div>;

  return (
    <main className="flex flex-col items-center min-h-screen py-16 px-4 bg-[var(--color-bg-secondary)]">
      <div className="w-full max-w-2xl flex flex-col gap-8">
        
        <div className="text-center">
          <h1 className="h1 mb-2">شما وارد لیست انتظار شدید</h1>
          <p className="text-body">تبریک! ثبت‌نام شما با موفقیت انجام شد.</p>
        </div>

        <Card className="flex flex-col items-center justify-center p-8 text-center border-2 border-[var(--color-primary-light)]">
          <p className="text-small mb-2">رتبه فعلی شما در لیست انتظار</p>
          <div className="text-6xl font-bold text-[var(--color-primary)]">#{rank}</div>
          <p className="text-small mt-4">ما هنگام باز شدن دسترسی، به ترتیب اولویت اطلاع‌رسانی خواهیم کرد.</p>
        </Card>

        {status === 'WAITLIST' && (
          <Card className="flex flex-col items-center text-center bg-white border-2 border-[var(--color-accent)] relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-[var(--color-accent)]"></div>
            
            <h2 className="h2 mb-2">ارتقا به دسترسی نسل اول</h2>
            <p className="text-small mb-6 text-balance">
              با فعال کردن عضویت اولیه، رتبه شما به گروه اول منتقل می‌شود و هنگام شروع فعالیت عمومی، زودتر از سایر کاربران وارد پلتفرم خواهید شد.
            </p>

            <div className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">
              ۲۹۹,۰۰۰ <span className="text-base text-[var(--color-text-secondary)] font-normal">تومان</span>
            </div>

            <Button size="lg" fullWidth variant="secondary" onClick={handleEarlyAccess} disabled={paymentLoading}>
              {paymentLoading ? 'در حال انتقال...' : 'فعال کردن دسترسی نسل اول'}
            </Button>
          </Card>
        )}

        <Card className="flex flex-col gap-4">
          <h3 className="h3 !font-size-lg">دعوت دوستان</h3>
          <p className="text-small">
            با معرفی دوستان خود، اولویت شما در لیست انتظار افزایش می‌یابد. 
            هر دعوت موفق = ۵۰ رتبه بهبود جایگاه.
          </p>
          <div className="flex gap-2">
            <input 
              readOnly 
              value={`${process.env.NEXT_PUBLIC_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '')}/?ref=${refCode}`} 
              className="flex-1 px-3 py-2 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-md text-left text-sm"
              dir="ltr"
            />
            <Button variant="outline" onClick={copyLink}>کپی لینک</Button>
          </div>
        </Card>

        <Card className="flex flex-col gap-4">
          <h3 className="h3 !font-size-lg">وضعیت صف کاربران</h3>
          <p className="text-small text-[var(--color-text-secondary)]">
            در حال تشکیل اولین گروه کاربران کارنو. دعوت‌نامه‌ها بر اساس اولویت ثبت‌نام و امتیاز معرفی ارسال خواهند شد.
          </p>
        </Card>

      </div>
    </main>
  );
}
