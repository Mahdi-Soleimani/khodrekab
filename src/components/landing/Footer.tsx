import React from 'react';
import Image from 'next/image';

export function Footer() {
  return (
    <footer className="w-full bg-white pt-16 pb-8 border-t border-slate-100">
      <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row justify-between items-start gap-12 mb-12">
        <div className="flex flex-col gap-4 max-w-sm">
          <div className="flex items-center gap-3">
            <Image 
              src="/images/logo-jeyhub.jpg" 
              alt="Jeyhub Logo" 
              width={40} 
              height={40}
              className="rounded-lg shadow-sm"
            />
            <span className="font-black text-xl text-slate-900 tracking-tight">خودرکاب</span>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed">
            خودرکاب، دستیار هوشمند شما برای بررسی و تحلیل بازار خودرو. با ما با چشمان باز معامله کنید.
          </p>
        </div>
        
        <div className="flex gap-16">
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-slate-900">دسترسی سریع</h4>
            <ul className="flex flex-col gap-3 text-sm text-slate-500">
              <li><a href="#" className="hover:text-primary transition-colors">درباره ما</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">تماس با ما</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">قوانین و مقررات</a></li>
            </ul>
          </div>
          
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-slate-900">ارتباط با ما</h4>
            <ul className="flex flex-col gap-3 text-sm text-slate-500">
              <li><a href="#" className="hover:text-primary transition-colors">اینستاگرام</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">لینکدین</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">تلگرام</a></li>
            </ul>
          </div>
        </div>
      </div>
      
      <div className="max-w-5xl mx-auto px-6 text-center pt-8 border-t border-slate-100 text-xs text-slate-400">
        <p>تمامی حقوق برای تیم جی‌هاب محفوظ است. © {new Date().getFullYear()}</p>
      </div>
    </footer>
  );
}
