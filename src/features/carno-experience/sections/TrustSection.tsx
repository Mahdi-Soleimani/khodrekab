'use client';

import React from 'react';

export function TrustSection() {
  const trustPoints = [
    {
      icon: '🏢',
      title: 'توسعه‌یافته توسط تیم جی‌هاب',
      desc: 'کارنو محصولی تخصصی از تیم جی‌هاب (Jeyhub) برای ایجاد شفافیت داده‌محور در بازار معاملات خودرو است.',
    },
    {
      icon: '⏳',
      title: 'وضعیت کنونی: در حال آماده‌سازی',
      desc: 'سیستم در مراحل پایانی تست و ارزیابی کیفیت قرار دارد. لانچ عمومی برای حدود یک ماه دیگر برنامه‌ریزی شده است.',
    },
    {
      icon: '🔒',
      title: 'حفظ حریم خصوصی شماره همراه',
      desc: 'شماره شما صرفاً برای ارسال کد دسترسی و اطلاع‌رسانی وضعیت نوبت استفاده می‌شود؛ هیچ پیامک تبلیغاتی ارسال نخواهد شد.',
    },
    {
      icon: '💬',
      title: 'پاسخگویی مستقیم سازندگان',
      desc: 'برای هرگونه پیشنهاد، همکاری یا سوال، می‌توانید مستقیماً از طریق پشتیبانی با تیم سازنده در ارتباط باشید.',
    },
  ];

  return (
    <section 
      id="trust-section"
      className="w-full py-24 px-6 bg-[#0B1124] text-white border-t border-slate-800/80 relative z-20"
      aria-labelledby="trust-heading"
    >
      <div className="max-w-4xl mx-auto flex flex-col items-center">
        {/* Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300 font-semibold mb-6">
          <span>شفافیت و اعتماد</span>
        </div>

        <h2 
          id="trust-heading"
          className="text-2xl sm:text-4xl font-black text-center text-white tracking-tight mb-4"
        >
          چرا کارنو را شفاف می‌سازیم؟
        </h2>
        <p className="text-sm sm:text-base text-slate-400 text-center mb-14 max-w-xl leading-relaxed">
          اعتماد، اولین پیش‌نیاز تصمیم‌گیری درست است. ما معتقدیم قبل از هر خریدی، ابزاری که استفاده می‌کنید باید کاملاً شفاف باشد.
        </p>

        {/* Trust Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-3xl">
          {trustPoints.map((item, idx) => (
            <div 
              key={idx}
              className="p-6 rounded-2xl bg-[#111830] border border-slate-800 flex flex-col gap-3 text-right"
            >
              <div className="text-2xl mb-1">{item.icon}</div>
              <h3 className="text-base font-bold text-white">
                {item.title}
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Contact direct link */}
        <div className="mt-10 text-center">
          <a
            href="https://t.me/jeyhub_support"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs sm:text-sm text-slate-300 hover:text-white bg-slate-800/70 hover:bg-slate-800 border border-slate-700 px-5 py-2.5 rounded-full transition-colors"
          >
            <span>ارتباط با تیم جی‌هاب در تلگرام</span>
            <span aria-hidden="true" className="text-xs">↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}

