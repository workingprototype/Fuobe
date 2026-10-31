"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { signInHref, useHydrated, useViewer } from "@/lib/api";

/**
 * The install's settings, for its owner only. A guest (public sign-up) is offered an account, which
 * connects its own GPU here; an account sees Your GPU (AccountGpuSection) and nothing of the install's.
 */
export function OwnerSettings({ children }: { children: React.ReactNode }) {
  // The server renders nothing here (it doesn't know the viewer), so hydration must too, even when the browser's
  // viewer query has already answered (a component outside this page's boundary asked first).
  const hydrated = useHydrated();
  const v = useViewer().data;
  if (!hydrated || !v) return null;
  if (v.owner) return <>{children}</>;
  if (v.account) return <p className="py-8 text-[13px] text-muted-foreground">The studio&apos;s own settings, keys and tokens are its owner&apos;s.</p>;
  return (
    <section className="space-y-3 py-8">
      <h2 className="text-[15px] font-semibold">Run Fuobe on your own GPU</h2>
      <p className="max-w-xl text-[13px] text-muted-foreground">
        Create a free account, then connect your own ComfyUI: your runs go to your GPU. It must be reachable from the internet, for example through a Cloudflare Tunnel or ngrok.
      </p>
      <div className="flex gap-2">
        <Button asChild size="sm">
          <Link href={signInHref("signup", "/settings#your-gpu")}>Sign up free</Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href={signInHref("login", "/settings#your-gpu")}>Log in</Link>
        </Button>
      </div>
    </section>
  );
}
