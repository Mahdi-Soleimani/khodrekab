import React from 'react';

export function ThreeStepSection() {
  const steps = [
    {
      number: '۱',
      title: 'نیازت را مشخص کن',
      desc: 'بازه بودجه، مدل‌های مدنظر یا معیارهای اولویت‌دار خود را تعیین می‌کنی تا بررسی دقیق روی اهداف مشخص متمرکز شود.',
    },
    {
      number: '۲',
      title: 'خودرکاب بازار را بررسی می‌کند',
      desc: 'خودرکاب به‌صورت پیوسته آگهی‌ها و نوسانات قیمت بازار را تحلیل کرده و پیشنهادها را با معیارهای واقعی مقایسه می‌کند.',
    },
    {
      number: '۳',
      title: 'گزینه‌هایی را ببین که ارزش بررسی دارند',
      desc: 'به‌جای ساعت‌ها گشتن در میان صدها آگهی نامطمئن، گزینه‌های زیر قیمت بازار و نشانه‌های مهم معامله را شفاف دریافت می‌کنی.',
    },
  ];

  return (
    <section 
      id="three-step-section"
      className="w-full py-24 px-6 bg-[#050814] text-white border-t border-slate-800/80 relative z-20"
      aria-labelledby="three-step-heading"
    >
      <div className="max-w-5xl mx-auto flex flex-col items-center">
        {/* Pill badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300 font-semibold mb-6">
          <span>ساده و شفاف</span>
        </div>

        <h2 
          id="three-step-heading"
          className="text-2xl sm:text-4xl font-black text-center text-white tracking-tight mb-4"
        >
          خودرکاب چگونه مسیر خرید خودرو را آسان می‌کند؟
        </h2>
        <p className="text-sm sm:text-base text-slate-400 text-center mb-16 max-w-xl leading-relaxed">
          سه گام ساده تا رسیدن به انتخابی مطمئن و آگاهانه در بازار خودرو.
        </p>

        {/* 3 Step Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-4xl relative">
          {steps.map((step, idx) => (
            <div 
              key={idx}
              className="flex flex-col items-center text-center p-8 rounded-3xl bg-[#0B1124] border border-slate-800 hover:border-slate-700 transition-all duration-300 relative group"
            >
              <div className="w-14 h-14 rounded-2xl bg-[#111830] border border-slate-700 flex items-center justify-center font-black text-xl text-[#E31C4E] mb-6 shadow-sm group-hover:scale-105 group-hover:border-[#E31C4E]/50 transition-all">
                {step.number}
              </div>

              <h3 className="text-lg font-bold text-white mb-3">
                {step.title}
              </h3>
              
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
