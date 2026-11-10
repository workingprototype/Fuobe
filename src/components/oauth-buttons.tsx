import { Button } from "@/components/ui/button";
import { GitHubMark } from "@/components/github-mark";
import { GoogleMark } from "@/components/google-mark";
import type { OAuthProviderId } from "@/lib/api";
import { cn } from "@/lib/utils";

export const PROVIDER_LABEL: Record<OAuthProviderId, string> = { google: "Google", github: "GitHub" };

/** Where "Continue with …" goes: the provider's sign-in, then back to `next` (a path on this site). */
export function oauthHref(p: OAuthProviderId, next: string, mode: "signup" | "login"): string {
  const q = new URLSearchParams({ mode });
  if (next !== "/") q.set("next", next);
  return `/api/auth/oauth/${p}?${q}`;
}

/** "Continue with Google" and "Continue with GitHub": full-page links to the provider (GET /api/auth/oauth/<provider>). */
export function OAuthButtons({
  providers,
  next,
  mode,
  className,
  size = "lg",
}: {
  providers: OAuthProviderId[];
  next: string;
  mode: "signup" | "login";
  className?: string;
  size?: "lg" | "sm";
}) {
  if (!providers.length) return null;
  return (
    <div className={cn("grid gap-2.5", className)}>
      {providers.map((p) => (
        <Button key={p} asChild variant="outline" className={cn("w-full gap-2.5", size === "lg" ? "h-11" : "h-9")}>
          <a href={oauthHref(p, next, mode)}>
            {p === "google" ? <GoogleMark className="size-[18px]" /> : <GitHubMark className="size-[18px]" />}
            Continue with {PROVIDER_LABEL[p]}
          </a>
        </Button>
      ))}
    </div>
  );
}
