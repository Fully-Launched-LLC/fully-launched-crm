"use client";

import { useEffect } from "react";

// Registers public/sw.js (see that file for what it does and doesn't cache).
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Not fatal: the app works without it, it just isn't installable.
      });
    }
  }, []);
  return null;
}
