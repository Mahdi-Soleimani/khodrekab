'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

export function CinematicNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToWaitlist = () => {
    document.getElementById('waitlist-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
      scrolled 
        ? 'bg-white/90 backdrop-blur-xl border-b border-black/[0.04] py-3' 
        : 'bg-transparent py-6'
    }`}>
      <div className="container flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#E31C3D] rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-black">C</span>
          </div>
          <span className="text-xl font-black text-[#111111] tracking-tight">کارنو</span>
        </div>
        
        {/* CTA */}
        <div className="flex items-center gap-6">
          <button 
            onClick={scrollToWaitlist} 
            className="text-sm font-medium text-[#666666] hover:text-[#111111] transition-colors hidden sm:block"
          >
            نسخه اول
          </button>
          <Button size="sm" onClick={scrollToWaitlist}>
            دریافت دسترسی اولیه
          </Button>
        </div>
      </div>
    </nav>
  );
}
