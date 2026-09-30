'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useRouter } from 'next/navigation';
import posthog from 'posthog-js';

export default function PaymentPage() {
  const [timeLeft, setTimeLeft] = useState(15 * 60); // 15 mins default
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'PENDING' | 'PAID' | 'EXPIRED'>('PENDING');
  
  const [intentData, setIntentData] = useState<any>(null);
  const router = useRouter();
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const cardNumber = '۶۰۳۷-۹۹۸۱-۴۵۶۷-۸۹۰۱'; // Mock for Demo

  useEffect(() => {
    const dataStr = localStorage.getItem('paymentIntent');
    if (dataStr) {
      const data = JSON.parse(dataStr);
      setIntentData(data);
      const diff = Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000);
      setTimeLeft(diff > 0 ? diff : 0);
    } else {
      router.push('/waitlist');
    }
  }, [router]);

  useEffect(() => {
    if (timeLeft <= 0 && status === 'PENDING') {
      setStatus('EXPIRED');
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, status]);

  // Polling for payment success
  useEffect(() => {
    if (status !== 'PENDING') return;

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/waitlist/status');
        const data = await res.json();
        if (data?.data?.status === 'EARLY_ACCESS') {
          setStatus('PAID');
          posthog.capture('payment_success');
          if (pollingRef.current) clearInterval(pollingRef.current);
        }
      } catch (e) {}
    }, 5000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [status]);

  const minutes = Math.floor(Math.max(0, timeLeft) / 60);
  const seconds = Math.max(0, timeLeft) % 60;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(cardNumber.replace(/-/g, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const retryPayment = async () => {
    posthog.capture('payment_started');
    const res = await fetch('/api/payment/intent', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('paymentIntent', JSON.stringify(data.data));
      window.location.reload();
    }
  };

  if (!intentData) return null;

  return (
    <main className="flex flex-col items-center min-h-screen py-16 px-4 bg-[var(--color-bg-secondary)]">
      <div className="w-full max-w-lg flex flex-col gap-6">
        <h1 className="h2 text-center">پرداخت دسترسی نسل اول</h1>

        {status === 'EXPIRED' ? (
          <Card className="text-center p-8 border-2 border-[var(--color-error)]">
            <h2 className="text-xl font-bold text-[var(--color-error)] mb-2">زمان پرداخت به پایان رسید</h2>
            <p className="mb-6 text-small">شناسه یکتای شما منقضی شده است. لطفاً برای دریافت شناسه جدید مجدداً تلاش کنید.</p>
            <Button onClick={retryPayment}>تلاش مجدد</Button>
          </Card>
        ) : status === 'PAID' ? (
          <Card className="text-center p-8 border-2 border-[var(--color-success)]">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-[var(--color-success)] mb-2">پرداخت شما تایید شد!</h2>
            <p className="mb-6 text-body">شما با موفقیت به جمع کاربران نسل اول پیوستید.</p>
            <Button onClick={() => router.push('/waitlist')}>بازگشت به داشبورد</Button>
          </Card>
        ) : (
          <Card className="flex flex-col items-center border-2 border-[var(--color-primary)] relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-[var(--color-primary)]"></div>
            
            <div className="w-full text-center bg-[var(--color-bg-tertiary)] py-3 -mt-6 mx-[-1.5rem] mb-6 border-b border-[var(--color-border)] text-[var(--color-error)] font-bold text-lg">
              زمان باقیمانده: {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
            </div>

            <p className="text-small text-center mb-6">
              جهت فعال‌سازی، مبلغ دقیق زیر را به شماره کارت اعلام شده واریز نمایید. سیستم بلافاصله پس از دریافت پیامک بانکی، پرداخت شما را تایید می‌کند.
            </p>

            <div className="w-full bg-[var(--color-bg-tertiary)] rounded-lg p-6 mb-6">
              <div className="flex justify-between items-center mb-4">
                <span className="text-small">مبلغ قابل پرداخت:</span>
                <span className="text-2xl font-bold text-[var(--color-primary)]">
                  {intentData.totalAmount.toLocaleString()} <span className="text-sm font-normal">تومان</span>
                </span>
              </div>
              
              <div className="flex justify-between items-center mb-1">
                <span className="text-small">شماره کارت:</span>
                <span className="font-bold text-lg dir-ltr font-mono">{cardNumber}</span>
              </div>
              <div className="flex justify-between items-center mb-4 text-xs text-[var(--color-text-tertiary)]">
                <span>به نام: کارنو (جی‌هاب)</span>
              </div>
              
              <Button 
                variant="outline" 
                size="sm" 
                fullWidth 
                onClick={copyToClipboard}
              >
                {copied ? 'شماره کارت کپی شد' : 'کپی شماره کارت'}
              </Button>
            </div>

            <div className="w-full p-4 bg-yellow-50 text-yellow-800 text-sm rounded-lg mb-6 border border-yellow-200">
              <strong>توجه بسیار مهم:</strong> مبلغ واریزی باید دقیقاً <strong className="text-lg">{intentData.totalAmount.toLocaleString()}</strong> تومان باشد (با احتساب رقم خرد). در غیر این صورت سیستم قادر به شناسایی پرداخت شما نخواهد بود.
            </div>

            <div className="flex items-center justify-center gap-2 text-small text-[var(--color-text-secondary)]">
              <div className="w-4 h-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin"></div>
              در حال انتظار برای دریافت تاییدیه بانک...
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
