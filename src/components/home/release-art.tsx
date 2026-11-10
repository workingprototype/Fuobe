"use client";

import { useEffect, useRef, useState } from "react";
import { usePreviewsPaused } from "@/components/preset-preview";
import { cn } from "@/lib/utils";

/**
 * The latest release's card (release-art.css draws it): its rows drift while it is on screen, and stop with the site's
 * Pause previews (one setting for every preview). The tiles themselves are server-rendered children.
 */
export function ReleaseArtCard({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const paused = usePreviewsPaused();
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: "120px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} role="group" aria-label={label} data-paused={paused || !onScreen ? "" : undefined} className={cn("rart", className)}>
      {children}
    </div>
  );
}
