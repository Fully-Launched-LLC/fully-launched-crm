"use client";

import { useEffect, useRef, useState } from "react";
import { LAUNCH_VIDEO_SRC, ROCKET_IDLE_SRC } from "@/components/lead-finder/assets";

// Matteo's launch pad: idle rocket, 3-2-1 countdown, launch video keyed onto
// a canvas (near-black pixels made transparent so the flame sits on the
// starfield), flash, and a card slot for the orbit / touchdown cards.
// Assets: ROCKET_IDLE_SRC / LAUNCH_VIDEO_SRC (assets.ts). The idle image and
// the canvas share one box, fit and mask; the idle image stays up until the
// first video frame is drawn, so the swap has no blank frame.

export type Phase = "idle" | "countdown" | "flying" | "orbit" | "touchdown";

export default function RocketStage({
  phase,
  count,
  onFlightDone,
  card,
}: {
  phase: Phase;
  count: number;
  onFlightDone: () => void;
  card: React.ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [flash, setFlash] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const doneRef = useRef(onFlightDone);
  doneRef.current = onFlightDone;

  useEffect(() => {
    if (phase !== "flying") return;
    const v = video.current;
    const c = canvas.current;
    if (!v || !c) return;
    let finished = false;
    let raf = 0;
    const done = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      doneRef.current();
    };

    // Canvas at the video's own size (any replacement launch.mp4 works); CSS
    // fits it into the same box as the idle image.
    if (v.videoWidth && v.videoHeight) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
    // Key the video's black background out, frame by frame (his keyFrame()).
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const W = c.width;
    const H = c.height;
    const LO = 8;
    const HI = 40;
    let last = -1;
    const tick = () => {
      if (finished || !ctx) return;
      if (v.readyState >= 2 && v.currentTime !== last) {
        last = v.currentTime;
        ctx.drawImage(v, 0, 0, W, H);
        try {
          const img = ctx.getImageData(0, 0, W, H);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const m = r > g ? (r > b ? r : b) : g > b ? g : b;
            if (m <= LO) {
              d[i + 3] = 0;
              continue;
            }
            if (m < HI) {
              const a = (m - LO) / (HI - LO);
              d[i] = Math.min(255, r / a);
              d[i + 1] = Math.min(255, g / a);
              d[i + 2] = Math.min(255, b / a);
              d[i + 3] = a * 255;
            }
          }
          ctx.putImageData(img, 0, 0);
        } catch {
          c.style.mixBlendMode = "screen";
        }
        setDrawn(true);
      }
      raf = requestAnimationFrame(tick);
    };

    try {
      v.currentTime = 0;
      v.playbackRate = 0.8;
    } catch {}
    setFlash((n) => n + 1);
    v.onended = done;
    try {
      const p = v.play();
      if (p && p.catch) p.catch(done);
    } catch {
      done();
    }
    raf = requestAnimationFrame(tick);
    const safety = setTimeout(done, 9000); // safety net
    return () => {
      finished = true;
      cancelAnimationFrame(raf);
      clearTimeout(safety);
      v.onended = null;
    };
  }, [phase]);

  // Back on the pad: rewind and clear the canvas.
  useEffect(() => {
    if (phase !== "flying") setDrawn(false);
    if (phase !== "idle") return;
    const v = video.current;
    try {
      v?.pause();
      if (v) v.currentTime = 0;
    } catch {}
    canvas.current?.getContext("2d")?.clearRect(0, 0, canvas.current.width, canvas.current.height);
  }, [phase]);

  const cls = phase === "flying" ? (drawn ? " flying" : "") : phase === "orbit" || phase === "touchdown" ? " gone" : "";

  return (
    <section className={`stage${cls}`} aria-label="Launch pad">
      <div className="rocket">
        <div className="ground" aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="idle" src={ROCKET_IDLE_SRC} alt="FullyLaunched rocket on the launch pad" />
        <canvas ref={canvas} width={544} height={712} aria-hidden="true" />
        <video ref={video} src={LAUNCH_VIDEO_SRC} muted playsInline preload="auto" aria-hidden="true" />
        <div key={flash} className={`flash${flash ? " on" : ""}`} aria-hidden="true" />
        <div aria-live="polite">
          {phase === "countdown" && (
            <div key={count} className="count-num">
              {count}
            </div>
          )}
        </div>
      </div>
      {card}
    </section>
  );
}
