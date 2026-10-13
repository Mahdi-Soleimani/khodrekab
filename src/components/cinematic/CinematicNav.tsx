'use client';
import { useState, useEffect } from 'react';

export function CinematicNav() {
  const [scrolled, setScrolled] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 40);
    };
    window.addEventListener('scroll', handleScroll);

    fetch('/api/waitlist/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setIsAuthenticated(true);
        }
      })
      .catch(() => {});

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <nav 
      aria-label="منوی اصلی"
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled 
          ? 'bg-[#050814]/85 backdrop-blur-xl border-b border-slate-800/80 py-3 shadow-lg shadow-black/40' 
          : 'bg-gradient-to-b from-black/80 via-black/30 to-transparent py-5'
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
        {/* Brand / Logo */}
        <div 
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex items-center gap-3 cursor-pointer group"
        >
          <div className="w-8 h-8 bg-[#E31C4E] rounded-lg flex items-center justify-center font-black text-white text-base shadow-md shadow-[#E31C4E]/30 group-hover:scale-105 transition-transform">
            K
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-black text-white tracking-tight">خودرکاب</span>
            <span className="text-[10px] text-slate-400 font-medium -mt-1 hidden sm:inline">با عدد، نه با حدس</span>
          </div>
        </div>
        
        {/* Navigation Links & Action */}
        <div className="flex items-center gap-5 sm:gap-7">
          <button 
            onClick={() => scrollTo('sample-analysis')} 
            className="text-xs sm:text-sm font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            نمونه تحلیل
          </button>
          <button 
            onClick={() => scrollTo('early-access')} 
            className="text-xs sm:text-sm font-medium text-slate-300 hover:text-white transition-colors cursor-pointer hidden md:block"
          >
            دسترسی نسل اول
          </button>
          {isAuthenticated ? (
            <a
              href="/dashboard"
              className="bg-[#E31C4E] hover:bg-[#C21641] text-white text-xs sm:text-sm font-bold py-2 sm:py-2.5 px-4 sm:px-5 rounded-full shadow-md shadow-[#E31C4E]/20 transition-all duration-200 active:scale-95 flex items-center gap-1.5"
            >
              <span>ورود به داشبورد</span>
              <span className="text-xs">←</span>
            </a>
          ) : (
            <button
              onClick={() => scrollTo('waitlist-registration')}
              className="bg-[#E31C4E] hover:bg-[#C21641] text-white text-xs sm:text-sm font-bold py-2 sm:py-2.5 px-4 sm:px-5 rounded-full shadow-md shadow-[#E31C4E]/20 transition-all duration-200 active:scale-95 cursor-pointer"
            >
              دریافت دسترسی اولیه
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

