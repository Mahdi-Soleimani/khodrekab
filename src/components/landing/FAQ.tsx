'use client';
import React, { useState } from 'react';

export function FAQ() {
  const faqs = [
    {
      question: 'کارنو دقیقا چطور قیمت‌ها را تشخیص می‌دهد؟',
      answer: 'کارنو با تحلیل روزانه ده‌ها هزار آگهی خودرو و مقایسه آن‌ها با داده‌های تاریخی، معاملات واقعی و افت قیمت مدل‌ها، یک قیمت پایه کاملا علمی و مبتنی بر دیتا ارائه می‌دهد.'
    },
    {
      question: 'تفاوت Founder\'s Pass با ثبت‌نام معمولی چیست؟',
      answer: 'دارندگان Founder\'s Pass در زمان عرضه عمومی بدون در نظر گرفتن صف انتظار وارد پلتفرم می‌شوند، به امکانات پریمیوم دسترسی مادام‌العمر خواهند داشت و نشان ویژه دریافت می‌کنند.'
    },
    {
      question: 'چه زمانی نسخه اصلی منتشر می‌شود؟',
      answer: 'ما در حال حاضر در فاز تست نسخه Early Access هستیم. پس از تکمیل ظرفیت لیست انتظار و اطمینان از کیفیت خدمات، عرضه عمومی به صورت مرحله‌ای آغاز خواهد شد.'
    },
    {
      question: 'آیا برای استفاده نیاز به دانش فنی دارم؟',
      answer: 'خیر. کارنو پیچیده‌ترین تحلیل‌های دیتا را در قالب یک داشبورد ساده و زیبا به شما نمایش می‌دهد تا بتوانید مثل یک دلال حرفه‌ای، اما بدون نیاز به تخصص آن‌ها، تصمیم بگیرید.'
    }
  ];

  return (
    <section className="w-full py-32 px-6 bg-slate-50 border-y border-slate-200/60">
      <div className="max-w-5xl mx-auto flex flex-col items-center">
        <h2 className="h2 mb-16 text-center text-slate-900">سوالات متداول</h2>
        
        <div className="w-full max-w-3xl flex flex-col gap-4">
          {faqs.map((faq, i) => (
            <FAQItem key={i} question={faq.question} answer={faq.answer} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQItem({ question, answer }: { question: string, answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`bg-white rounded-2xl border ${isOpen ? 'border-primary/30 shadow-lg shadow-primary/5' : 'border-slate-100'} overflow-hidden transition-all duration-300`}>
      <button 
        className="w-full text-right p-6 flex justify-between items-center font-bold text-slate-900 hover:bg-slate-50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{question}</span>
        <span className={`text-primary text-2xl transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`}>
          +
        </span>
      </button>
      <div 
        className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="p-6 pt-0 text-slate-500 leading-relaxed text-sm">
          {answer}
        </div>
      </div>
    </div>
  );
}
