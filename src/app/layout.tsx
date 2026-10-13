import type { Metadata } from "next";
import localFont from "next/font/local";
import { AnalyticsProvider } from "@/components/providers/AnalyticsProvider";
import "./globals.css";

const vazirmatn = localFont({
  src: "./fonts/Vazirmatn-Variable.woff2",
  display: "swap",
  variable: "--font-vazirmatn",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "خودرکاب - دستیار هوشمند بازار خودرو",
  description: "قبل از خرید خودرو، بازار را بهتر بشناسید و فرصت‌های خرید ارزشمند را پیدا کنید.",
  openGraph: {
    title: "خودرکاب - دستیار هوشمند بازار خودرو",
    description: "قبل از خرید خودرو، بازار را بهتر بشناسید و فرصت‌های خرید ارزشمند را پیدا کنید.",
    url: "https://khodrekab.ir",
    siteName: "Khodrekab",
    locale: "fa_IR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "خودرکاب - دستیار هوشمند بازار خودرو",
    description: "قبل از خرید خودرو، بازار را بهتر بشناسید و فرصت‌های خرید ارزشمند را پیدا کنید.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} dark`}>
      <body className="bg-[#020617] text-slate-50 antialiased selection:bg-blue-500/30 min-h-screen">
        <AnalyticsProvider>
          {children}
        </AnalyticsProvider>
      </body>
    </html>
  );
}
