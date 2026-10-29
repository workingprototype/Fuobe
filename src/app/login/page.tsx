import type { Metadata } from "next";
import { connection } from "next/server";
import { Lock } from "lucide-react";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { Skeleton } from "@/components/ui/skeleton";
import { installName } from "@/server/mode";

export const metadata: Metadata = { title: "Sign in" };

/** The install's name for the card's line ("Sign in to Fuobe."): read per request, never prerendered. */
async function Card() {
  await connection();
  return <LoginForm installName={installName()} />;
}

/** The card's frame while the name loads (prerendered; no field yet). */
function CardShell() {
  return (
    <div className="w-full max-w-sm rounded-2xl border bg-background p-7 shadow-soft max-[400px]:p-6" aria-busy>
      <div className="mb-5 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Lock className="size-5" aria-hidden />
      </div>
      <h1 className="font-heading text-[28px] leading-tight">Welcome back</h1>
      <Skeleton className="mt-2 h-4 w-40" />
      <Skeleton className="mt-6 h-11 w-full" />
      <Skeleton className="mt-4 h-11 w-full" />
    </div>
  );
}

export default function Page() {
  return (
    <main className="grid min-h-svh place-items-center bg-sidebar px-4">
      <Suspense fallback={<CardShell />}>
        <Card />
      </Suspense>
    </main>
  );
}
