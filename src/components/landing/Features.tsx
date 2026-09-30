'use client';
import React from 'react';
import posthog from 'posthog-js';

export function Features() {
  const features = [
    {
      title: 'کشف قیمت واقعی',
      description: 'دیگر نیازی به حدس زدن نیست. ما قیمت منصفانه هر خودرو را بر اساس تاریخچه معاملات، مدل و سال ساخت محاسبه می‌کنیم تا دقیقا بدانید چه مبلغی می‌پردازید.',
      icon: '📊'
    },
    {
      title: 'شناخت فرصت‌های پنهان',
      description: 'هوش مصنوعی کارنو، خودروهایی که زیر قیمت واقعی بازار قیمت‌گذاری شده‌اند را پیش از دیگران به شما نشان می‌دهد.',
      icon: '🎯'
    },
    {
      title: 'تصمیم مطمئن‌تر',
      description: 'بدون استرس معامله کنید. با شناسایی ریسک‌های پنهان، از خرید خودروهای دردسرساز جلوگیری کنید.',
      icon: '🧠'
    }
  ];

  const handleFeatureClick = (title: string) => {
    posthog.capture('feature_click', { feature: title });
  };

  return (
    <section className="w-full py-32 px-6 bg-white relative">
      <div className="max-w-5xl mx-auto flex flex-col items-center relative z-10">
        <h2 className="h2 mb-20 text-center text-slate-900">چرا کارنو یک ابزار لوکس نیست، یک ضرورت است؟</h2>

        <div className="flex flex-col md:flex-row justify-between gap-12 w-full">
          {features.map((feature, i) => (
            <div 
              key={i} 
              className="flex-1 flex flex-col items-start gap-4 cursor-pointer group"
              onClick={() => handleFeatureClick(feature.title)}
            >
              <div className="w-16 h-16 bg-slate-50 border border-slate-100 flex items-center justify-center rounded-2xl shadow-sm text-3xl group-hover:bg-primary/5 group-hover:border-primary/20 transition-all duration-300">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold text-slate-900 group-hover:text-primary transition-colors">{feature.title}</h3>
              <p className="text-base text-slate-500 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
