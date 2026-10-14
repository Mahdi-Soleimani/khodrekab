'use client';

import React from 'react';

export function HowItWorksSection() {
  return (
    <section className="py-24 bg-gray-50 text-gray-900 w-full" aria-labelledby="how-it-works-heading">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="how-it-works-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
            How The Engine Works
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            Behind the seamless experience is a complex orchestration of visual assets and memory management.
          </p>
        </div>

        <div className="mt-16 max-w-lg mx-auto lg:max-w-none">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-4">
            <div className="flex flex-col text-center">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-indigo-100 text-indigo-600 mb-6 font-bold text-xl">
                1
              </div>
              <h3 className="text-lg font-semibold mb-2">Detection</h3>
              <p className="text-gray-600 text-sm">
                The engine detects your device profile, network speed, and screen constraints to serve the optimal asset tier (mobile vs desktop).
              </p>
            </div>
            
            <div className="flex flex-col text-center">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-indigo-100 text-indigo-600 mb-6 font-bold text-xl">
                2
              </div>
              <h3 className="text-lg font-semibold mb-2">Intelligence</h3>
              <p className="text-gray-600 text-sm">
                Keyframes are loaded immediately to establish the baseline. Missing frames are intelligently interpolated and loaded progressively.
              </p>
            </div>

            <div className="flex flex-col text-center">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-indigo-100 text-indigo-600 mb-6 font-bold text-xl">
                3
              </div>
              <h3 className="text-lg font-semibold mb-2">Automation</h3>
              <p className="text-gray-600 text-sm">
                A Bitmap Cache protects memory thresholds, automatically discarding unused frames while keeping high-priority keyframes pinned.
              </p>
            </div>

            <div className="flex flex-col text-center">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-indigo-100 text-indigo-600 mb-6 font-bold text-xl">
                4
              </div>
              <h3 className="text-lg font-semibold mb-2">Result</h3>
              <p className="text-gray-600 text-sm">
                A 120 FPS cinematic scrolling experience mapped perfectly to physical DOM scroll events, with zero jank or frame dropping.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
