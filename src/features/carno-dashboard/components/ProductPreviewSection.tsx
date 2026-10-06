import React from 'react';
import { QueryStatsIcon, RadarIcon, SensorsIcon } from '../icons/DashboardIcons';

export function ProductPreviewSection() {
  const capabilities = [
    {
      title: 'قیمت واقعی بازار',
      description: 'می‌فهمی قیمت یک خودرو نسبت به بازار کجاست.',
      icon: <QueryStatsIcon size={28} className="text-emerald-400" />,
      tag: 'تحلیل قیمت',
    },
    {
      title: 'فرصت‌های ارزش بررسی',
      description: 'گزینه‌هایی که ارزش وقت گذاشتن دارند.',
      icon: <RadarIcon size={28} className="text-rose-400" />,
      tag: 'غربال هوشمند',
    },
    {
      title: 'تحلیل آگهی و فروشنده',
      description: 'نشانه‌هایی که در نگاه اول دیده نمی‌شوند.',
      icon: <SensorsIcon size={28} className="text-amber-400" />,
      tag: 'سیگنال رفتاری',
    },
  ];

  return (
    <section 
      id="product-preview"
      className="flex flex-col gap-6 pt-6 text-right"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="px-3.5 py-1 rounded-full bg-amber-500/15 text-amber-300 font-bold text-xs md:text-sm border border-amber-500/30">
            پیش‌نمایش قابلیت‌ها
          </span>
        </div>
        
        <h3 className="text-2xl md:text-3xl lg:text-4xl text-white font-extrabold tracking-tight">
          وقتی Carno فعال شود، اینجا چه می‌بینی؟
        </h3>
        
        <p className="text-base md:text-lg text-slate-200 font-medium max-w-3xl leading-relaxed">
          تصویری شفاف از ابزارهایی که پس از آغاز دسترسی رسمی پلتفرم، برای تصمیم‌گیری دقیق در خرید خودرو در اختیارت قرار می‌گیرد.
        </p>
      </div>

      {/* 3 Concise Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {capabilities.map((cap) => (
          <div 
            key={cap.title}
            className="bg-[#131c31] p-7 md:p-8 rounded-2xl shadow-xl flex flex-col justify-between border border-slate-800 hover:border-slate-700 transition-all text-right"
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="w-14 h-14 rounded-2xl bg-[#0a0e1a] flex items-center justify-center border border-slate-700 shadow-inner">
                  {cap.icon}
                </div>
                <span className="text-xs md:text-sm font-bold text-slate-200 bg-slate-800/90 px-3.5 py-1.5 rounded-full border border-slate-700">
                  {cap.tag}
                </span>
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <h4 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                  {cap.title}
                </h4>
                <p className="text-base md:text-lg text-slate-200 font-medium leading-relaxed">
                  {cap.description}
                </p>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-slate-800/80 flex items-center justify-between text-sm text-slate-400 font-medium">
              <span>وضعیت:</span>
              <span className="text-slate-300 font-semibold">در فاز لانچ عمومی</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
