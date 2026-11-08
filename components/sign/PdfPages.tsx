"use client";

import { useEffect, useRef, useState } from "react";

// Renders a PDF (short-lived signed URL) as canvases with PDF.js, sized to
// the container, so the frozen proposal / SOW read well on phones too.
export default function PdfPages({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        // Static copy (scripts/copy-pdf-worker.mjs); bundling it breaks the build.
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        const pdf = await pdfjs.getDocument({ url }).promise;
        const el = box.current;
        if (!el || cancelled) return;
        el.innerHTML = "";
        const width = el.clientWidth || 800;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.setAttribute("aria-label", `${title}, page ${n}`);
          el.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
          if (cancelled) return;
        }
        setState("ready");
      } catch (e) {
        console.error(e);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, title]);

  return (
    <>
      {state === "loading" && <p className="pdf-loading">Loading {title}...</p>}
      {state === "error" && (
        <p className="pdf-loading">
          Could not show the document here.{" "}
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open the PDF
          </a>
          .
        </p>
      )}
      <div ref={box} className="pdf-pages" />
    </>
  );
}
