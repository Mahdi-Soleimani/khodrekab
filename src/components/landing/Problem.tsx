import React from 'react';

export function Problem() {
  const problems = [
    {
      illusion: 'ظاهر سالم',
      reality: 'معامله خوب',
      desc: 'بیش از ۶۰٪ خودروهای کارکرده دارای مشکلات فنی پنهان یا افت قیمت نامرئی هستند.'
    },
    {
      illusion: 'قیمت آگهی',
      reality: 'ارزش واقعی',
      desc: 'قیمت‌گذاری هیجانی فروشندگان باعث می‌شود تا خریداران ناآگاه میلیون‌ها تومان ضرر کنند.'
    },
    {
      illusion: 'تجربه شخصی',
      reality: 'تحلیل بازار',
      desc: 'حتی یک مکانیک هم نمی‌تواند تاریخچه قیمت و ریسک‌های بازار یک مدل خاص را در لحظه تحلیل کند.'
    }
  ];

  return (
    <section className="w-full py-24 px-6 bg-slate-50 border-y border-slate-200">
      <div className="max-w-4xl mx-auto flex flex-col items-center">
        <h2 className="h2 mb-4 text-center text-slate-900">بزرگترین اشتباه هنگام خرید خودرو چیست؟</h2>
        <p className="text-body text-center mb-16 text-slate-500">
          ما معمولاً بر اساس احساسات و اطلاعات محدود تصمیم می‌گیریم. اما در بازاری که پر از عدم قطعیت است، اتکا به چشم‌ها کافی نیست.
        </p>

        <div className="flex flex-col gap-10 w-full max-w-2xl">
          {problems.map((problem, i) => (
            <div key={i} className="flex flex-col md:flex-row items-center gap-6 p-8 rounded-3xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="flex items-center gap-4 text-xl font-bold">
                <span className="text-slate-400 line-through decoration-red-400 decoration-2">{problem.illusion}</span>
                <span className="text-slate-300">≠</span>
                <span className="text-emerald-600">{problem.reality}</span>
              </div>
              <div className="md:border-r md:border-slate-100 md:pr-6 md:mr-2">
                <p className="text-sm text-slate-500 leading-relaxed text-center md:text-right">{problem.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
