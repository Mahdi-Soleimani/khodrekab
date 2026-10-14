import React from 'react';
import Image from 'next/image';

export function ProductPreview() {
  return (
    <section className="w-full py-24 px-6 max-w-5xl mx-auto relative">
      <div className="flex flex-col items-center mb-16 text-center">
        <h2 className="h2 mb-4 text-slate-900">هوش مصنوعی، جایگزین حدس و گمان</h2>
        <p className="text-body text-slate-600 max-w-2xl">
          دیگر نیازی نیست ساعت‌ها بین آگهی‌ها سردرگم شوید. پلتفرم ما با بررسی اطلاعات پنهان بازار، تصویر واضح‌تری از ارزش واقعی و ریسک هر خودرو به شما می‌دهد.
        </p>
      </div>

      <div className="w-full relative h-[450px] md:h-[650px] rounded-3xl overflow-hidden shadow-2xl shadow-slate-200/50 border border-slate-200 bg-white group mx-auto">
        {/* Sleek Browser/App Header Mockup */}
        <div className="absolute top-0 left-0 w-full h-12 bg-slate-50/80 backdrop-blur-sm flex items-center px-4 gap-2 z-20 border-b border-slate-100">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400"></div>
            <div className="w-3 h-3 rounded-full bg-amber-400"></div>
            <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
          </div>
          <div className="mx-auto w-1/3 h-6 bg-slate-100 rounded-md"></div>
        </div>
        
        <Image 
          src="/images/dashboard-preview.jpg" 
          alt="Khodrekab Dashboard" 
          fill
          className="object-cover object-top pt-12 group-hover:scale-[1.01] transition-transform duration-700 ease-in-out"
        />

        {/* Floating Glass Element Over the Image */}
        <div className="absolute bottom-6 left-6 z-30 bg-white/70 backdrop-blur-xl p-5 rounded-2xl border border-white shadow-lg w-[280px]">
          <h3 className="font-bold text-slate-800 mb-2">امتیاز ارزش خرید</h3>
          <div className="flex items-end gap-2 mb-4">
            <span className="text-4xl font-extrabold text-emerald-600">۸۵</span>
            <span className="text-sm text-slate-500 mb-1">از ۱۰۰</span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 w-[85%] rounded-full"></div>
          </div>
          <p className="text-xs text-slate-500 mt-3 flex items-center gap-1">
            <span className="text-emerald-500">✓</span>
            ۴٪ ارزان‌تر از میانگین بازار
          </p>
        </div>

      </div>
    </section>
  );
}
