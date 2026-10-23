"use client";

import { Loader2 } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A Link that prefetches on intent: nothing while it merely sits on screen, then the usual prefetch
 * once the pointer is over it, a finger touches it or it gets keyboard focus (the "hover-triggered
 * prefetch" of Next's prefetching guide). `eager` rows prefetch as soon as they're on screen, like a
 * plain Link: the few routes most visits go to next. A page full of these no longer fetches every
 * route behind it on a cold visit.
 */
export function IntentLink({
  eager,
  onMouseEnter,
  onTouchStart,
  onFocus,
  ...props
}: React.ComponentProps<typeof Link> & { eager?: boolean }) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={eager || intent ? null : false}
      onMouseEnter={(e) => {
        setIntent(true);
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
    />
  );
}

/**
 * Click feedback on a card while its page loads (useLinkStatus: the moment between the click and the
 * new route). Put it inside a positioned Link; it takes no space and only shows when the route is slow
 * (the fade starts after 120 ms), so fast navigations don't flash.
 */
export function CardPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 grid animate-pending-in place-items-center rounded-[inherit] bg-black/25 text-white",
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin" />
    </span>
  );
}
