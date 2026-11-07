import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PageAnalytics } from "./components/PageAnalytics";
import { PaletteSwitcher } from "./components/PaletteSwitcher";
import { HOME_DESCRIPTION, HOME_TITLE, SITE_URL, SOCIAL_IMAGE } from "./lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  keywords: ["coding agent trading", "AI trading agent", "self-hosted trading", "open source trading", "Claude Code", "Codex", "Trading as Git", "trading desk", "crypto trading", "algorithmic trading"],
  authors: [{ name: "OpenAlice" }],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    siteName: "OpenAlice",
    type: "website",
    locale: "en_US",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    creator: "@OpenAliceAI",
    images: [SOCIAL_IMAGE.url],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isVercel = process.env.VERCEL === "1";

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        {children}
        {process.env.NODE_ENV !== "production" && <PaletteSwitcher />}
        {isVercel && (
          <>
            <Analytics />
            <PageAnalytics />
            <SpeedInsights />
          </>
        )}
      </body>
    </html>
  );
}
