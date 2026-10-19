"use client";

import { Brain, FolderPlus, MessageSquarePlus, MessagesSquare, Search, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PROJECT_HUE, type AssistProject, type AssistThreadSummary } from "@/lib/assist";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useChatActions, useChats, useProjects } from "./hooks";
import { ProjectDialog } from "./project-dialog";

/**
 * Assist's own sidebar (Supercomputer's): New chat, Search, Skills, Memory, Projects and Chats.
 * A column from xl up; below that the same list opens as a sheet from the header button.
 */

export function AssistShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r bg-sidebar/40 xl:flex md:h-[calc(100svh-0.5rem)]" aria-label="Assist">
        <Suspense fallback={<RailSkeleton />}>
          <Rail />
        </Suspense>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The header button that opens the Assist sidebar below xl. */
export function RailButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className={cn("xl:hidden", className)} onClick={() => setOpen(true)} aria-label="Chats, projects, skills and memory">
            <MessagesSquare />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Chats, projects, skills and memory</TooltipContent>
      </Tooltip>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[min(86vw,320px)] gap-0 p-0" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Assist</SheetTitle>
          <SheetDescription className="sr-only">Chats, projects, skills and memory</SheetDescription>
          <Suspense fallback={<RailSkeleton />}>
            <Rail onNavigate={() => setOpen(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>
    </>
  );
}

function RailSkeleton() {
  return (
    <div className="space-y-2 p-3">
      <Skeleton className="h-9 rounded-full" />
      <Skeleton className="h-8" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-7" />
      ))}
    </div>
  );
}

function RailLink({ href, icon: Icon, label, active, onNavigate }: { href: string; icon: typeof Brain; label: string; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn("flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-accent", active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      <Icon className="size-4" /> {label}
    </Link>
  );
}

export function ProjectDot({ project, className }: { project: Pick<AssistProject, "color">; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full bg-[oklch(0.68_0.13_var(--p-hue))]", className)} style={{ "--p-hue": PROJECT_HUE[project.color] } as React.CSSProperties} />;
}

function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const router = useRouter();
  const current = params.get("c");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const chats = useChats(q ? { q } : { project: "none" });
  const projects = useProjects();
  const actions = useChatActions();
  const [creating, setCreating] = useState(false);
  const [doomed, setDoomed] = useState<AssistThreadSummary | null>(null);

  const remove = async (t: AssistThreadSummary) => {
    try {
      await actions.remove(t.id);
      if (t.id === current) router.replace("/assist", { scroll: false });
      toast("Chat deleted", { duration: 1500 });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 p-3 pb-2">
        <Button asChild variant="outline" className="h-9 w-full justify-start rounded-full">
          <Link href="/assist" onClick={onNavigate}>
            <MessageSquarePlus /> New chat
          </Link>
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="h-8 rounded-lg pr-7 pl-8 text-[13px]" />
          {query && (
            <button onClick={() => setQuery("")} className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="size-3" />
            </button>
          )}
        </div>
        <nav className="space-y-0.5" aria-label="Assist pages">
          <RailLink href="/assist/skills" icon={Sparkles} label="Skills" active={pathname.startsWith("/assist/skills")} onNavigate={onNavigate} />
          <RailLink href="/assist/memory" icon={Brain} label="Memory" active={pathname.startsWith("/assist/memory")} onNavigate={onNavigate} />
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {!q && (
          <section aria-labelledby="rail-projects" className="mb-4">
            <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
              <h2 id="rail-projects" className="text-[11px] font-medium tracking-wide text-subtle-foreground uppercase">
                Projects
              </h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={() => setCreating(true)} aria-label="New project">
                    <FolderPlus />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New project</TooltipContent>
              </Tooltip>
            </div>
            {projects.isLoading ? (
              <Skeleton className="mx-2.5 h-6" />
            ) : projects.data?.length ? (
              <ul className="space-y-0.5">
                {projects.data.map((p) => {
                  const active = pathname === `/assist/projects/${p.id}`;
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/assist/projects/${p.id}`}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn("flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors hover:bg-accent", active ? "bg-accent font-medium" : "text-foreground/85")}
                      >
                        <ProjectDot project={p} />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        {p.chats > 0 && <span className="font-mono text-[11px] text-subtle-foreground">{p.chats}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <button onClick={() => setCreating(true)} className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground">
                Group chats with shared instructions and sources →
              </button>
            )}
          </section>
        )}
        <section aria-labelledby="rail-chats">
          <h2 id="rail-chats" className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-subtle-foreground uppercase">
            {q ? `Results for “${q}”` : "Chats"}
          </h2>
          {chats.isLoading ? (
            <div className="space-y-1.5 px-2.5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-6" />
              ))}
            </div>
          ) : chats.data?.threads.length ? (
            <ul className="space-y-0.5">
              {chats.data.threads.map((t) => {
                const project = t.projectId ? projects.data?.find((p) => p.id === t.projectId) : undefined;
                return (
                  <li key={t.id} className="group/chat relative">
                    <Link
                      href={`/assist?c=${t.id}`}
                      onClick={onNavigate}
                      aria-current={t.id === current ? "page" : undefined}
                      className={cn("flex min-h-8 flex-col justify-center rounded-lg py-1.5 pr-8 pl-2.5 transition-colors hover:bg-accent", t.id === current && "bg-accent")}
                    >
                      <span className="truncate text-[13px]">{t.title}</span>
                      {(q || t.status !== "idle") && (
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {project && <ProjectDot project={project} className="size-1.5" />}
                          {project ? `${project.name} · ` : ""}
                          {t.status === "running" ? "Working…" : t.status === "waiting" ? "Waiting for you" : timeAgo(t.updatedAt)}
                        </span>
                      )}
                    </Link>
                    <button
                      onClick={() => setDoomed(t)}
                      className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-100 hover:text-destructive focus-visible:opacity-100 sm:opacity-0 sm:group-hover/chat:opacity-100"
                      aria-label={`Delete ${t.title}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2.5 py-2 text-[12px] text-muted-foreground">{q ? "No chats match." : "Your chats will show up here."}</p>
          )}
        </section>
      </div>
      <AlertDialog open={!!doomed} onOpenChange={(o) => !o && setDoomed(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>“{doomed?.title}” and its messages are removed. Everything it made stays in your Library.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => doomed && void remove(doomed)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(p) => {
          onNavigate?.();
          router.push(`/assist/projects/${p.id}`);
        }}
      />
    </div>
  );
}
