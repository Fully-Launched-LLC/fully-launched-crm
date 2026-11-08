// Copies the PDF.js worker into public/pdfjs/ so the signing page can load it
// as a static file. Bundling it (new URL(..., import.meta.url)) breaks the
// Next 14 production build: Terser minifies the .mjs as a classic script.
// Runs before dev and build (package.json), so it follows the installed version.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public/pdfjs", { recursive: true });
copyFileSync("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "public/pdfjs/pdf.worker.min.mjs");
