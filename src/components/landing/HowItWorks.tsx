import React from 'react';

export function HowItWorks() {
  const steps = [
    {
      number: '۱',
      title: 'تنظیمات بودجه',
      description: 'تنظیمات جستجو و بودجه خود را وارد کنید. خودرکاب به صورت ۲۴ ساعته بازار را رصد می‌کند.'
    },
    {
      number: '۲',
      title: 'تحلیل عمیق',
      description: 'سیستم، آگهی‌های جدید را با هزاران داده تاریخی مقایسه کرده و ارزش واقعی را محاسبه می‌کند.'
    },
    {
      number: '۳',
      title: 'شکار فرصت',
      description: 'هنگامی که یک خودروی باارزش و زیر قیمت کارشناسی آگهی شود، بلافاصله مطلع می‌شوید.'
    }
  ];

  return (
    <section className="w-full py-32 px-6 bg-slate-50">
      <div className="max-w-5xl mx-auto flex flex-col items-center">
        <h2 className="h2 mb-20 text-center text-slate-900">فرآیند مهندسی شده برای خرید موفق</h2>
        
        <div className="flex flex-col md:flex-row items-start justify-center gap-12 md:gap-8 w-full max-w-4xl relative">
          {/* Connector line for desktop */}
          <div className="hidden md:block absolute top-8 left-[15%] right-[15%] h-px bg-slate-200 z-0"></div>
          
          {steps.map((step, i) => (
            <div key={i} className="flex flex-col items-center text-center relative z-10 w-full md:w-1/3 group">
              <div className="w-16 h-16 rounded-full bg-white border-2 border-slate-100 shadow-sm flex items-center justify-center font-bold text-2xl mb-6 transition-all duration-300 group-hover:-translate-y-1 group-hover:border-primary group-hover:shadow-md">
                <span className="text-slate-900 group-hover:text-primary transition-colors">{step.number}</span>
              </div>
              <h3 className="text-xl font-bold mb-3 text-slate-900">{step.title}</h3>
              <p className="text-base text-slate-500 leading-relaxed max-w-xs">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
