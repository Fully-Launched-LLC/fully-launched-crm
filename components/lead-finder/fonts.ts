import { JetBrains_Mono, Manrope, Space_Grotesk } from "next/font/google";

// Matteo's Lead Finder fonts, self-hosted by next/font and exposed as CSS
// variables on .lf-root only (lead-finder.css reads them).
const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--lf-display" });
const body = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--lf-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--lf-mono" });

export const LF_FONT_VARS = `${display.variable} ${body.variable} ${mono.variable}`;
