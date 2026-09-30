'use client';

import React from 'react';

export function TrustSection() {
  return (
    <div className="w-full py-12 bg-black text-white/70 border-t border-white/10 relative z-20">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <div className="text-3xl mb-2 opacity-80">🏎️</div>
          <h4 className="text-white font-medium text-lg tracking-wide">۱۲۰ فریم سینمایی</h4>
          <p className="text-sm opacity-60">تجربه‌ای بی‌نظیر با کیفیت استودیویی</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="text-3xl mb-2 opacity-80">⚡</div>
          <h4 className="text-white font-medium text-lg tracking-wide">تعاملی بدون ویدیو</h4>
          <p className="text-sm opacity-60">رندرینگ در لحظه بدون تاخیر بافت‌های ویدئویی</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="text-3xl mb-2 opacity-80">📱</div>
          <h4 className="text-white font-medium text-lg tracking-wide">بهینه شده برای موبایل</h4>
          <p className="text-sm opacity-60">مصرف هوشمند حافظه و اینترنت با فرمت WebP</p>
        </div>
      </div>
    </div>
  );
}
