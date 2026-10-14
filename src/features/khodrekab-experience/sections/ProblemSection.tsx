import React from 'react';

export function ProblemSection() {
  const comparisons = [
    {
      illusion: 'ظاهر سالم',
      reality: 'معامله خوب',
      desc: 'بسیاری از خودروهایی که در نگاه اول بی‌نقص به نظر می‌رسند، دچار افت قیمت پنهان، هزینه نگهداری نامتعارف یا شرایط معامله نامناسب هستند.',
    },
    {
      illusion: 'قیمت آگهی',
      reality: 'ارزش واقعی بازار',
      desc: 'قیمت اعلام‌شده در آگهی فقط خواسته فروشنده است؛ بدون مقایسه هوشمند با صدها معامله مشابه، تشخیص گران‌بودن یا منصفانه‌بودن ناممکن است.',
    },
    {
      illusion: 'حدس و گمان',
      reality: 'تصمیم‌گیری عددی',
      desc: 'پیدا کردن فرصت‌های واقعی زیر قیمت بازار و غربالگری ریسک‌های فروشنده نیازمند تحلیل داده است، نه اتکا به احساسات و شانس.',
    },
  ];

  return (
    <section 
      id="problem-section"
      className="w-full py-24 px-6 bg-[#050814] text-white border-t border-slate-800/80 relative z-20"
      aria-labelledby="problem-heading"
    >
      <div className="max-w-4xl mx-auto flex flex-col items-center">
        {/* Subtle pill tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-semibold mb-6">
          <span>ریشه‌ی اشتباه در خرید خودرو</span>
        </div>

        <h2 
          id="problem-heading"
          className="text-2xl sm:text-4xl font-black text-center text-white tracking-tight mb-4 leading-tight"
        >
          بزرگترین اشتباه هنگام خرید خودرو چیست؟
        </h2>
        <p className="text-sm sm:text-base text-slate-400 text-center mb-14 max-w-2xl leading-relaxed">
          بازار خودرو پر از نوسان، آگهی‌های گمراه‌کننده و قیمت‌گذاری‌های هیجانی است. در چنین فضایی، اتکا به چشم‌ها و حدس‌های شخصی معمولاً هزینه‌ساز می‌شود.
        </p>

        <div className="flex flex-col gap-6 w-full max-w-3xl">
          {comparisons.map((item, index) => (
            <div 
              key={index}
              className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5 p-6 sm:p-7 rounded-2xl bg-[#0B1124]/90 border border-slate-800 hover:border-slate-700/80 transition-all duration-300 shadow-sm"
            >
              <div className="flex items-center gap-3 text-lg sm:text-xl font-bold shrink-0">
                <span className="text-slate-500 line-through decoration-red-500/70 decoration-2">
                  {item.illusion}
                </span>
                <span className="text-slate-600 font-light" aria-hidden="true">≠</span>
                <span className="text-emerald-400">
                  {item.reality}
                </span>
              </div>

              <div className="md:border-r md:border-slate-800 md:pr-6 md:mr-2">
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed text-right">
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
