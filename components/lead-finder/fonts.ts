import localFont from "next/font/local";

// Matteo's Lead Finder fonts (Space Grotesk, Manrope, JetBrains Mono; all SIL
// Open Font License), self-hosted from components/lead-finder/fonts/ (Latin
// subset, variable weight) and exposed as CSS variables on .lf-root only
// (lead-finder.css reads them).
//
// Self-hosted rather than next/font/google: since Nov 4, 2026 Google Fonts
// serves some Space Grotesk files from extension-less URLs
// (fonts.gstatic.com/l/font?kit=...) and Next 14's Google loader crashes on
// them at build time.
const display = localFont({
  src: "./fonts/SpaceGrotesk-latin.woff2",
  weight: "300 700",
  variable: "--lf-display",
  display: "swap",
});
const body = localFont({
  src: "./fonts/Manrope-latin.woff2",
  weight: "200 800",
  variable: "--lf-body",
  display: "swap",
});
const mono = localFont({
  src: "./fonts/JetBrainsMono-latin.woff2",
  weight: "100 800",
  variable: "--lf-mono",
  display: "swap",
});

export const LF_FONT_VARS = `${display.variable} ${body.variable} ${mono.variable}`;
