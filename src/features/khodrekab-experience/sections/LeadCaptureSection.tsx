'use client';

import React, { useState, useEffect, useRef } from 'react';
import { KhodrekabAnalytics } from '../hooks/useKhodrekabExperience';

export function LeadCaptureSection() {
  const [formData, setFormData] = useState({ name: '', contact: '' });
  const [hasStarted, setHasStarted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  const sectionRef = useRef<HTMLElement>(null);
  const viewTracked = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !viewTracked.current) {
          viewTracked.current = true;
          KhodrekabAnalytics.track('lead_form_view', { source: 'landing_page' });
        }
      },
      { threshold: 0.5 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (!hasStarted) {
      setHasStarted(true);
      KhodrekabAnalytics.track('lead_form_started', { source: 'landing_page' });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    KhodrekabAnalytics.track('lead_submitted', { source: 'landing_page', hasName: !!formData.name, hasContact: !!formData.contact });
    setSubmitted(true);
    // Non-blocking submission: In a real environment, this would call an API
    // without blocking the user.
  };

  return (
    <section ref={sectionRef} className="py-24 bg-indigo-700 w-full" aria-labelledby="lead-heading">
      <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
        <h2 id="lead-heading" className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Ready to experience the future?
        </h2>
        <p className="mt-4 text-lg leading-8 text-indigo-200 mb-10">
          Leave your details below and we will notify you when the full 3D interactive platform is publicly available.
        </p>

        {submitted ? (
          <div className="bg-white/10 rounded-xl p-8 backdrop-blur-sm border border-white/20">
            <h3 className="text-2xl font-bold text-white mb-2">Thank you!</h3>
            <p className="text-indigo-200">We've received your information and will be in touch soon.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 justify-center max-w-2xl mx-auto">
            <div className="flex-1">
              <label htmlFor="name" className="sr-only">Name</label>
              <input
                type="text"
                name="name"
                id="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full rounded-md border-0 px-4 py-3.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm sm:leading-6"
                placeholder="Full Name"
                required
              />
            </div>
            <div className="flex-1">
              <label htmlFor="contact" className="sr-only">Email or Phone</label>
              <input
                type="text"
                name="contact"
                id="contact"
                value={formData.contact}
                onChange={handleChange}
                className="w-full rounded-md border-0 px-4 py-3.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm sm:leading-6"
                placeholder="Email address or Phone number"
                required
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-white px-8 py-3.5 text-sm font-semibold text-indigo-600 shadow-sm hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white transition-colors"
            >
              Get Early Access
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
