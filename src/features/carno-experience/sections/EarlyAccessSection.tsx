'use client';

import React, { useState, useCallback } from 'react';
import posthog from 'posthog-js';
import { CarnoAnalytics } from '../hooks/useCarnoExperience';

export function EarlyAccessSection() {
  const [showTestModal, setShowTestModal] = useState(false);

  const handleCtaClick = useCallback(() => {
    posthog.capture('early_access_clicked');
    CarnoAnalytics.track('early_access_clicked');
    setShowTestModal(true);
  }, []);

  return (
    <section 
      id="early-access"
      className="w-full py-28 px-6 bg-[#0B1124] text-white border-t border-slate-800/80 relative z-20"
      aria-labelledby="early-access-heading"
    >
      <div className="max-w-2xl mx-auto flex flex-col items-center relative z-10 text-center">
        
        {/* Accent Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E31C4E]/10 border border-[#E31C4E]/30 text-xs text-[#E31C4E] font-semibold mb-6">
          <span>دسترسی ویژه نسل اول</span>
        </div>

        <h2 
          id="early-access-heading"
          className="text-2xl sm:text-4xl font-black text-white tracking-tight mb-4 leading-tight"
        >
          می‌خواهی جزو نسل اول Carno باشی؟
        </h2>
        
        <p className="text-sm sm:text-base text-slate-400 max-w-md mb-12 leading-relaxed">
          نسخه اول کارنو را در کنار جمعی از خریداران هوشمند و فعالان بازار خودرو راه‌اندازی می‌کنیم.
        </p>

        {/* The Early Access Tier Card */}
        <div className="w-full max-w-md bg-[#111830] border border-slate-700/80 rounded-3xl p-8 sm:p-10 flex flex-col items-center shadow-2xl relative overflow-hidden">
          
          {/* Top red highlight */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500 via-[#E31C4E] to-amber-500" />

          {/* Pricing */}
          <div className="flex flex-col items-center gap-1 my-4">
            <span className="text-4xl sm:text-5xl font-black text-white tabular-nums tracking-tight font-mono">
              ۲۹۹٬۰۰۰
            </span>
            <span className="text-xs text-slate-400 font-medium">تومان / دسترسی اختصاصی</span>
          </div>

          {/* Benefits */}
          <ul className="flex flex-col gap-4 text-right w-full py-6 my-2 border-y border-slate-800 text-xs sm:text-sm text-slate-300">
            <li className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E31C4E] shrink-0" aria-hidden="true" />
              <span>اولویت ورود بدون نوبت در زمان آغاز فعالیت پلتفرم</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E31C4E] shrink-0" aria-hidden="true" />
              <span>دسترسی کامل به امکانات اولیه موتور تحلیل بازار</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E31C4E] shrink-0" aria-hidden="true" />
              <span>نشان اختصاصی بنیان‌گذار (Founder Badge) در پروفایل</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E31C4E] shrink-0" aria-hidden="true" />
              <span>ارتباط مستقیم و اولویت بازخورد با تیم توسعه محصول</span>
            </li>
          </ul>

          {/* Primary Action (Test Mode Guarded) */}
          <button
            type="button"
            onClick={handleCtaClick}
            className="w-full h-14 bg-[#E31C4E] hover:bg-[#C21641] text-white font-bold text-base rounded-2xl transition-all duration-200 shadow-lg shadow-[#E31C4E]/25 hover:shadow-[#E31C4E]/40 active:scale-95 cursor-pointer mt-4"
          >
            فعالسازی دسترسی نسل اول
          </button>

          <p className="text-[11px] text-slate-500 mt-3 text-center">
            تراکنش واقعی تا زمان تصویب نهایی سیاست بازگشت وجه انجام نمی‌شود
          </p>
        </div>

      </div>

      {/* TEST MODE MODAL PREVIEW */}
      {showTestModal && (
        <div 
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
        >
          <div className="bg-[#111830] border border-slate-700 w-full max-w-lg rounded-3xl p-6 sm:p-8 shadow-2xl relative text-right flex flex-col gap-5">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <span className="px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold">
                حالت پیش‌نمایش آزمایشی (Test Mode)
              </span>
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="text-slate-400 hover:text-white text-lg p-1 cursor-pointer transition-colors"
                aria-label="بستن"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <h3 id="modal-title" className="text-lg font-bold text-white">
                فرآیند فعالسازی دسترسی نسل اول
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                پرداخت واقعی در حال حاضر مطابق دستورالعمل راه‌اندازی غیرفعال است تا شرایط و ضوابط نهایی استرداد وجه به تأیید برسد.
              </p>
            </div>

            {/* Architectural Workflow Preview */}
            <div className="bg-[#0B1124] rounded-2xl p-4 border border-slate-800 flex flex-col gap-3 text-xs text-slate-300">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                <span className="text-slate-400">مبلغ عضویت:</span>
                <span className="font-mono text-white font-bold">۲۹۹٬۰۰۰ تومان</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                <span className="text-slate-400">روش فعالسازی نهایی:</span>
                <span className="text-white">کارت به کارت با شناسه یکتا و تایید پیامکی</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">وضعیت درگاه:</span>
                <span className="text-amber-400 font-medium">غیرفعال تا زمان اعلام رسمی لانچ</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              با ثبت‌نام در لیست انتظار بالا، به محض بازگشایی رسمی درگاه و شروع عضویت نسل اول، از طریق پیامک مطلع خواهید شد.
            </p>

            <button
              type="button"
              onClick={() => setShowTestModal(false)}
              className="w-full py-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-xl transition-colors cursor-pointer mt-2"
            >
              متوجه شدم و بازگشت به صفحه
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
