import type { Config } from "tailwindcss";
import { BRANCH_FILL } from "./lib/theme";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // Badge/pill class strings (branch, stage, owner colors) live in
    // lib/theme.ts — without this they're never generated.
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        header: {
          DEFAULT: "var(--color-header-bg)",
          foreground: "var(--color-header-fg)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          foreground: "var(--color-accent-fg)",
        },
        tan: "var(--color-tan)",
        // Fixed branch colors, sourced from lib/theme.ts.
        branch: {
          media: BRANCH_FILL.Media,
          websites: BRANCH_FILL.Websites,
          ecommerce: BRANCH_FILL.Ecommerce,
          ai: BRANCH_FILL.AI,
        },
      },
    },
  },
  plugins: [],
};
export default config;
