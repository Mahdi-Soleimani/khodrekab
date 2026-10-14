'use client';

import React, { useState } from 'react';

export function FAQSection() {
  const faqs = [
    {
      question: 'خودرکاب دقیقاً چه کمکی به من در خرید خودرو می‌کند؟',
      answer: 'خودرکاب با تحلیل پیوسته آگهی‌ها و مقایسه قیمت با داده‌های بازار، گزینه‌هایی را که زیر قیمت بازار به نظر می‌رسند یا ارزش بررسی بیشتری دارند شناسایی کرده و نشانه‌های مهم آگهی و فروشنده را پیش از تماس برایت خلاصه می‌کند.',
    },
    {
      question: 'آیا خروجی خودرکاب سود یا قیمت خودرو را تضمین می‌کند؟',
      answer: 'خیر. بازار خودرو بر اساس عرضه و تقاضا متغیر است و هر خودرو وضعیت فنی منحصربه‌فردی دارد. خودرکاب به شما کمک می‌کند با اتکا به عدد و سیگنال‌های واقعی بازار تصمیم بگیرید، اما جایگزین کارشناسی حضوری فنی و بدنه نمی‌شود.',
    },
    {
      question: 'ثبت‌نام در لیست انتظار چه مزیتی دارد؟',
      answer: 'ثبت‌نام کاملاً رایگان است و جایگاه شما را در صف اولین گروه کاربران خودرکاب تثبیت می‌کند. با دعوت از دوستان، جایگاه شما ارتقا یافته و سریع‌تر دعوت‌نامه ورود دریافت خواهید کرد.',
    },
    {
      question: 'دسترسی نسل اول چیست و چگونه فعال می‌شود؟',
      answer: 'دسترسی نسل اول برای کاربرانی است که تمایل دارند بدون صف و با اولویت اختصاصی وارد پلتفرم شوند. در حال حاضر تا زمان نهایی‌شدن قوانین بازگشت وجه، پرداخت غیرفعال است و به محض بازگشایی به ثبت‌نام‌کنندگان اطلاع داده خواهد شد.',
    },
    {
      question: 'حریم خصوصی شماره موبایل من چگونه حفظ می‌شود؟',
      answer: 'شماره شما صرفاً برای ارسال پیامک ورود و اطلاع‌رسانی مرحله‌ای دسترسی استفاده می‌شود. هیچ‌گونه پیامک تبلیغاتی یا فروش شماره به اشخاص ثالث انجام نخواهد شد.',
    },
  ];

  return (
    <section 
      id="faq-section"
      className="w-full py-24 px-6 bg-[#050814] text-white border-t border-slate-800/80 relative z-20"
      aria-labelledby="faq-heading"
    >
      <div className="max-w-4xl mx-auto flex flex-col items-center">
        {/* Pill */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300 font-semibold mb-6">
          <span>پاسخ به ابهامات</span>
        </div>

        <h2 
          id="faq-heading"
          className="text-2xl sm:text-4xl font-black text-center text-white tracking-tight mb-4"
        >
          سوالات متداول
        </h2>
        <p className="text-sm sm:text-base text-slate-400 text-center mb-14 max-w-xl leading-relaxed">
          نکات کلیدی پیرامون نحوه کار، مرحله راه‌اندازی و دسترسی به خودرکاب.
        </p>

        {/* FAQ Accordion */}
        <div className="w-full max-w-2xl flex flex-col gap-3">
          {faqs.map((faq, index) => (
            <FAQItem key={index} question={faq.question} answer={faq.answer} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
      isOpen ? 'bg-[#111830] border-slate-700 shadow-md' : 'bg-[#0B1124] border-slate-800/80 hover:border-slate-700'
    }`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="w-full p-5 text-right flex items-center justify-between gap-4 font-bold text-sm sm:text-base text-white cursor-pointer select-none"
      >
        <span>{question}</span>
        <span 
          aria-hidden="true" 
          className={`text-slate-400 text-xl font-mono shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-45 text-[#E31C4E]' : ''}`}
        >
          +
        </span>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 pt-1 text-xs sm:text-sm text-slate-300 leading-relaxed border-t border-slate-800/60 mt-1">
          {answer}
        </div>
      )}
    </div>
  );
}
