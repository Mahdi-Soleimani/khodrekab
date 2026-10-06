import React from 'react';

export function DashboardFooter() {
  return (
    <footer className="w-full bg-[#0B1124] border-t border-slate-800 py-6 mt-12">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-400">
        <span className="font-mono text-xs md:text-sm text-slate-400 font-medium">
          کارنو v1.0.4 Pre-Alpha
        </span>
        <span className="text-xs md:text-sm text-slate-300 font-medium text-center sm:text-right">
          کلیه حقوق متعلق به پلتفرم هوش تحلیل خودرو کارنو است
        </span>
      </div>
    </footer>
  );
}
