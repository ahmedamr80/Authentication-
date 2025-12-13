import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // 1. Base URL is perfect for SEO
  metadataBase: new URL('https://ewpuae.com'),

  title: "EveryWherePadel",
  description: "Padel Event Management",

  // 2. We REMOVED 'icons' and 'openGraph.images' here.
  // Why? Because Next.js automatically finds your 'icon.png' and 
  // 'opengraph-image.png' in the src/app folder and generates 
  // the correct tags with cache-busting hashes automatically.

  openGraph: {
    title: "EveryWherePadel", // Fixed Typo (removed extra 'P')
    description: "Join Padel EveryWherePadel events.",
    url: "https://ewpuae.com",
    siteName: "EveryWherePadel",
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}