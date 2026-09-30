'use client';

import React from 'react';
import { CarnoExperience } from '../components/CarnoExperience';
import { CinematicNav } from '@/components/cinematic/CinematicNav';

import { TrustSection } from '../sections/TrustSection';
import { LeadCaptureSection } from '../sections/LeadCaptureSection';

export function ProductLandingPage() {
  return (
    <main className="flex flex-col min-h-screen bg-black" itemScope itemType="https://schema.org/Product">
      <meta itemProp="name" content="Carno Interactive Vehicle Engine" />
      <meta itemProp="description" content="A seamless 3D cinematic vehicle scrolling experience." />
      
      {/* 1. Hero / Nav */}
      <header>
        <CinematicNav />
      </header>

      {/* 2. Car Experience (Scroll Engine + Interactive Canvas + Hero Content) */}
      <CarnoExperience />
      
      {/* 3. Trust & Social Proof */}
      <TrustSection />
      
      {/* 4. Conversion / Lead Capture */}
      <LeadCaptureSection />
    </main>
  );
}
