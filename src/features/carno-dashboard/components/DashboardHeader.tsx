'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { PersonIcon, LogoutIcon } from '../icons/DashboardIcons';

interface DashboardHeaderProps {
  maskedPhone: string;
  avatarUrl?: string;
}

export function DashboardHeader({ maskedPhone, avatarUrl }: DashboardHeaderProps) {
  const router = useRouter();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      router.push('/');
    }
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <>
      {/* Desktop Header */}
      <header className="hidden md:block fixed top-0 w-full z-50 bg-[#0B1124]/95 backdrop-blur-xl border-b border-slate-800">
        <div className="h-20 max-w-7xl mx-auto px-6 lg:px-8 flex items-center justify-between">
          
          {/* Logo & Slogan */}
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 relative overflow-hidden rounded-xl bg-[#E31C4E] flex items-center justify-center shadow-md shadow-rose-950/40">
              <Image 
                src="/images/carno-logo.png" 
                alt="Khodrekab Logo" 
                width={36} 
                height={36} 
                className="h-9 w-auto object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <span className="font-extrabold text-white text-lg">K</span>
            </div>
            <div className="flex flex-col text-right">
              <span className="font-extrabold text-xl text-white tracking-tight leading-tight">خودرکاب</span>
              <span className="text-xs text-rose-300 font-semibold tracking-wider">با عدد، نه با حدس</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex items-center gap-8 text-base font-semibold">
            <button 
              type="button"
              onClick={() => scrollToSection('top')}
              className="transition-colors text-white font-bold border-b-2 border-[#E31C4E] pb-1 cursor-pointer"
            >
              داشبورد
            </button>
            <button 
              type="button"
              onClick={() => scrollToSection('membership-card')}
              className="text-slate-200 hover:text-white transition-colors cursor-pointer"
            >
              وضعیت دسترسی
            </button>
            <button 
              type="button"
              onClick={() => scrollToSection('referral-card')}
              className="text-slate-200 hover:text-white transition-colors cursor-pointer"
            >
              دعوت دوستان
            </button>
            <button 
              type="button"
              onClick={() => scrollToSection('product-preview')}
              className="text-slate-200 hover:text-white transition-colors cursor-pointer"
            >
              پیش‌نمایش آینده
            </button>
          </nav>

          {/* Right Profile Controls */}
          <div className="flex items-center gap-4">
            {/* Profile Avatar & Dropdown */}
            <div className="relative">
              <button 
                type="button"
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="w-11 h-11 rounded-full overflow-hidden border-2 border-slate-700 hover:border-rose-500 hover:scale-105 transition-all cursor-pointer shadow-lg shadow-black/50 bg-[#E31C4E] flex items-center justify-center"
                aria-label="پروفایل کاربر"
              >
                {avatarUrl ? (
                  <Image 
                    src={avatarUrl} 
                    alt="User Profile" 
                    width={44} 
                    height={44} 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <PersonIcon size={22} className="text-white" />
                )}
              </button>

              {showProfileMenu && (
                <div className="absolute left-0 mt-3 w-56 bg-[#131c31] border border-slate-700 rounded-2xl shadow-2xl p-2.5 z-50 text-right animate-fadeIn">
                  <div className="px-3.5 py-2.5 border-b border-slate-800">
                    <span className="text-xs text-slate-400 font-medium block">شماره همراه</span>
                    <bdi dir="ltr" className="font-mono text-sm text-white block font-bold mt-0.5">
                      {maskedPhone}
                    </bdi>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="w-full mt-1.5 px-3.5 py-2.5 text-sm font-bold text-rose-400 hover:bg-slate-800/80 rounded-xl flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span>{loggingOut ? 'در حال خروج...' : 'خروج از حساب'}</span>
                    <LogoutIcon size={18} />
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      </header>

      {/* Mobile Top Header */}
      <header className="md:hidden fixed top-0 w-full z-50 pt-safe bg-[#0f131f]/95 backdrop-blur-xl border-b border-slate-800">
        <div className="h-16 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[#E31C4E] flex items-center justify-center text-white font-extrabold text-base">
              K
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base text-white tracking-tight">خودرکاب</span>
              <span className="text-[11px] text-rose-300 font-medium">با عدد، نه با حدس</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {avatarUrl && (
              <div className="w-8 h-8 rounded-full overflow-hidden border border-slate-700 shadow-sm shrink-0">
                <Image src={avatarUrl} alt="User" width={32} height={32} className="w-full h-full object-cover" />
              </div>
            )}
            <bdi dir="ltr" className="font-mono text-xs text-white font-bold bg-[#0a0e1a] px-3 py-1.5 rounded-lg border border-slate-700">
              {maskedPhone}
            </bdi>
            <button 
              type="button"
              onClick={handleLogout}
              title="خروج از حساب"
              className="w-9 h-9 rounded-full flex items-center justify-center text-slate-300 hover:text-rose-400 transition-colors"
              aria-label="خروج"
            >
              <LogoutIcon size={20} />
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
