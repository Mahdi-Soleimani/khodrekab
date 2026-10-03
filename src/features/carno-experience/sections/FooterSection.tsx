import React from 'react';

export function FooterSection() {
  return (
    <footer className="w-full bg-[#03060E] border-t border-slate-900 py-16 px-6 text-white relative z-20">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-start gap-10 pb-12 border-b border-slate-900">
        
        {/* Brand Information */}
        <div className="flex flex-col gap-3 max-w-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#E31C4E] rounded-lg flex items-center justify-center font-black text-white text-base shadow-sm">
              C
            </div>
            <span className="text-xl font-black text-white tracking-tight">کارنو</span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
            کارنو؛ پلتفرم ارزیابی هوشمند خودرو. تحلیل فرصت‌های زیر قیمت و نشانه‌های واقعی بازار با عدد، نه با حدس.
          </p>
          <span className="text-xs text-slate-400 font-medium">
            توسعه‌یافته توسط تیم جی‌هاب (Jeyhub)
          </span>
        </div>

        {/* Quick Links */}
        <div className="flex gap-12 sm:gap-16">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-bold text-slate-300">دسترسی سریع</span>
            <ul className="flex flex-col gap-2.5 text-xs text-slate-400">
              <li>
                <a href="#sample-analysis" className="hover:text-white transition-colors">
                  نمونه تحلیل محصول
                </a>
              </li>
              <li>
                <a href="#three-step-section" className="hover:text-white transition-colors">
                  نحوه عملکرد
                </a>
              </li>
              <li>
                <a href="#early-access" className="hover:text-white transition-colors">
                  دسترسی نسل اول
                </a>
              </li>
              <li>
                <a href="#waitlist-registration" className="hover:text-white transition-colors">
                  ثبت‌نام در لیست انتظار
                </a>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-xs font-bold text-slate-300">ارتباط و پشتیبانی</span>
            <ul className="flex flex-col gap-2.5 text-xs text-slate-400">
              <li>
                <a 
                  href="https://t.me/jeyhub_support" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors flex items-center gap-1"
                >
                  <span>پشتیبانی تلگرام</span>
                  <span aria-hidden="true" className="text-[10px]">↗</span>
                </a>
              </li>
              <li>
                <a href="#faq-section" className="hover:text-white transition-colors">
                  سوالات متداول
                </a>
              </li>
            </ul>
          </div>
        </div>

      </div>

      <div className="max-w-5xl mx-auto pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400 text-center sm:text-right">
        <p>تمامی حقوق برای تیم جی‌هاب محفوظ است. © {new Date().getFullYear()}</p>
        <p className="text-[11px] text-slate-400 font-medium">با عدد، نه با حدس</p>
      </div>
    </footer>
  );
}
