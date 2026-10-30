import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import { BRAND_NAVY_HEX } from "@/lib/theme";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Fully Launched CRM",
  description: "Internal CRM for Fully Launched",
  // Installable as "FL Clock" (start_url /clock). See CLAUDE.md for install
  // steps.
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "FL Clock" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: BRAND_NAVY_HEX,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
