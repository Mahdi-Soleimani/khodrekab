import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import { AnalyticsProvider } from "@/components/providers/AnalyticsProvider";
import "./globals.css";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  display: "swap",
  variable: "--font-vazirmatn",
});

export const metadata: Metadata = {
  title: "کارنو - دستیار هوشمند بازار خودرو",
  description: "قبل از خرید خودرو، بازار را بهتر بشناسید و فرصت‌های خرید ارزشمند را پیدا کنید.",
  openGraph: {
    title: "کارنو - دستیار هوشمند بازار خودرو",
    description: "قبل از خرید خودرو، بازار را بهتر بشناسید و فرصت‌های خرید ارزشمند را پیدا کنید.",
    url: "https://carno.ir",
    siteName: "Carno",
    locale: "fa_IR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "کارنو - دستیار هوشمند بازار خودرو",
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
