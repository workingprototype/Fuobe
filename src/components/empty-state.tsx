"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Compass, Home, RotateCcw, TriangleAlert } from "lucide-react";
import { Suspense } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

/** A calm full-page state (Liner style): serif headline, one muted line, one or two actions. */
export function PageState({
  icon: Icon = Compass,
  title,
  children,
  actions,
}: {
  icon?: typeof Compass;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      <div className="sticky top-0 z-20 flex h-12 items-center px-3 md:hidden">
        <SidebarTrigger />
      </div>
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col items-center justify-center px-6 pb-[12vh] text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">
          <Icon className="size-5" />
        </span>
        <h1 className="mt-5 font-heading text-[34px] leading-tight text-balance">{title}</h1>
        {children && <div className="mt-2 text-[15px] text-pretty text-muted-foreground">{children}</div>}
        {actions && <div className="mt-7 flex flex-wrap justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Where to send someone from a dead link, based on the section they were in. */
const SECTIONS: { prefix: string; href: string; label: string }[] = [
  { prefix: "/apps", href: "/apps", label: "Browse apps" },
  { prefix: "/elements", href: "/elements", label: "All elements" },
  { prefix: "/motions", href: "/motions", label: "Camera motions" },
  { prefix: "/effects", href: "/effects", label: "Effects" },
  { prefix: "/library", href: "/library", label: "Your library" },
  { prefix: "/cinema", href: "/cinema", label: "Cinema projects" },
  { prefix: "/canvas", href: "/canvas", label: "Your canvases" },
  { prefix: "/assist", href: "/assist", label: "Back to Assist" },
];

function SectionLink() {
  const pathname = usePathname() ?? "";
  const s = SECTIONS.find((x) => pathname === x.prefix || pathname.startsWith(`${x.prefix}/`));
  if (!s) return null;
  return (
    <Button asChild variant="outline">
      <Link href={s.href}>
        <ArrowLeft /> {s.label}
      </Link>
    </Button>
  );
}

export function NotFoundState({ title = "Nothing here", children }: { title?: string; children?: React.ReactNode }) {
  return (
    <PageState
      title={title}
      actions={
        <>
          <Suspense fallback={null}>
            <SectionLink />
          </Suspense>
          <Button asChild>
            <Link href="/">
              <Home /> Back to Home
            </Link>
          </Button>
        </>
      }
    >
      {children ?? "The page you’re looking for moved, or never existed. Everything you made is still in your library."}
    </PageState>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest?: string }).digest ?? "") : "";
  const message = error instanceof Error ? error.message : "";
  return (
    <PageState
      icon={TriangleAlert}
      title="Something went wrong"
      actions={
        <>
          {retry && (
            <Button onClick={retry}>
              <RotateCcw /> Try again
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/">
              <Home /> Back to Home
            </Link>
          </Button>
        </>
      }
    >
      <p>This page hit an error. Your creations and settings are safe.</p>
      {(message || digest) && (
        <p className="mt-3 rounded-lg bg-muted px-3 py-2 font-mono text-[12px] break-words text-muted-foreground">
          {message}
          {digest && <span className="block text-muted-foreground">ref {digest}</span>}
        </p>
      )}
    </PageState>
  );
}
