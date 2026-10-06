import React from 'react';

export function SampleAnalysisSection() {
  return (
    <section 
      id="sample-analysis"
      className="w-full py-24 px-6 bg-[#0B1124] text-white border-t border-slate-800/80 relative z-20"
      aria-labelledby="sample-analysis-heading"
    >
      <div className="max-w-4xl mx-auto flex flex-col items-center">
        {/* Section Pill */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-semibold mb-6">
          <span>خروجی هوشمند محصول</span>
        </div>

        <h2 
          id="sample-analysis-heading"
          className="text-2xl sm:text-4xl font-black text-center text-white tracking-tight mb-4"
        >
          نمونه تحلیل Carno
        </h2>
        <p className="text-sm sm:text-base text-slate-400 text-center mb-12 max-w-xl leading-relaxed">
          کارنو آگهی‌های خودرو را به اعداد و نشانه‌های قابل اتکا تبدیل می‌کند تا قبل از هدر دادن وقت، کیفیت فرصت را بسنجید.
        </p>

        {/* Structural Analysis Card */}
        <div className="w-full max-w-2xl bg-[#111830] border border-slate-700/80 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
          
          {/* MANDATORY ATTACHED LABEL - permanently attached to card */}
          <div className="absolute top-0 right-0 left-0 bg-slate-800/90 border-b border-slate-700 px-4 py-2 flex items-center justify-between text-xs text-slate-300 font-medium z-10">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" />
              <span>نمونه نمایشی از خروجی Carno</span>
            </span>
            <span className="text-[11px] text-slate-400 font-mono">ID: CARNO-SAMPLE-PREVIEW</span>
          </div>

          <div className="pt-8">
            {/* Vehicle Header Placeholder */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-6 border-b border-slate-800">
              <div>
                <span className="text-xs font-medium text-slate-400">آگهی مورد بررسی:</span>
                <h3 className="text-lg sm:text-xl font-bold text-white mt-1">
                  پژو ۲۰۷i دنده‌ای · مدل ۱۴۰۲ (سفید)
                </h3>
                <span className="text-xs text-slate-400">کارکرد: ۲۸٬۰۰۰ کیلومتر · بدون رنگ</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold self-start sm:self-auto">
                <span>فرصت مستعد بررسی</span>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-6 border-b border-slate-800">
              
              {/* Metric 1: Price Comparison */}
              <div className="bg-[#0B1124] border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
                <span className="text-xs text-slate-400 font-medium">وضعیت قیمت نسبت به بازار</span>
                <div className="my-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded">
                      حدود ۴٪ زیر میانگین بازار
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    قیمت اعلامی آگهی در دامنه‌ی پایین‌تر از میانگین معاملات ۳۰ روز اخیر قرار دارد.
                  </p>
                </div>
              </div>

              {/* Metric 2: Opportunity Score */}
              <div className="bg-[#0B1124] border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">شاخص فرصت معامله</span>
                  <span className="text-xs text-emerald-400 font-bold">ارزش خرید بالا</span>
                </div>
                <div className="my-2">
                  <div className="flex items-end gap-1.5">
                    <span className="text-3xl font-black text-white">۸۷</span>
                    <span className="text-xs text-slate-400 mb-1">از ۱۰۰</span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mt-2">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 w-[87%] rounded-full" />
                  </div>
                </div>
              </div>

            </div>

            {/* Seller & Listing Signals (Probabilistic Wording) */}
            <div className="pt-6 flex flex-col gap-3">
              <span className="text-xs font-semibold text-slate-300">نشانه‌های آگهی و فروشنده:</span>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="flex items-start gap-2 bg-[#0B1124] p-3 rounded-xl border border-slate-800">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span className="text-slate-300">
                    <strong className="text-white font-medium">احتمال نوع فروشنده:</strong> بر اساس الگوی ثبت آگهی، احتمال فروشنده شخصی بالاست.
                  </span>
                </div>

                <div className="flex items-start gap-2 bg-[#0B1124] p-3 rounded-xl border border-slate-800">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span className="text-slate-300">
                    <strong className="text-white font-medium">تطابق مشخصات:</strong> استهلاک و کیلومتر اعلامی با سن خودرو همخوانی دارد.
                  </span>
                </div>
              </div>

              {/* Summary note */}
              <div className="bg-slate-900/60 rounded-xl p-3.5 border border-slate-800/80 mt-2">
                <p className="text-xs text-slate-400 leading-relaxed">
                  <strong className="text-slate-300">جمع‌بندی هوشمند:</strong> این گزینه پتانسیل بررسی دارد. توصیه می‌شود وضعیت رنگ و سلامت فنی در بازدید حضوری اعتبارسنجی شود.
                </p>
              </div>
            </div>

          </div>
        </div>

        {/* Honest Transparency Footnote */}
        <p className="text-xs text-slate-400 text-center mt-6 max-w-xl">
          * مقادیر بالا ساختار خروجی تحلیلی کارنو را نمایش می‌دهند. نسخه نهایی محاسبات را مستقیماً بر اساس داده‌های لحظه‌ای بازار خودرو انجام می‌دهد.
        </p>
      </div>
    </section>
  );
}
