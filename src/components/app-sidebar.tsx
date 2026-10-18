"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Suspense, useCallback, useState } from "react";
import {
  AtSign,
  MessageCircle,
  GalleryHorizontal,
  Layers,
  Crop,
  FastForward,
  Brush,
  AudioLines,
  Boxes,
  ChevronRight,
  Clapperboard,
  Cpu,
  Film,
  Home,
  ImageIcon,
  LayoutGrid,
  ListChecks,
  Mic2,
  Moon,
  Network,
  Plus,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Video,
  Wand2,
  Workflow,
  ZoomIn,
  Library,
  PersonStanding,
  Scissors,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Kbd } from "@/components/ui/kbd";
import { GlobalShortcuts } from "@/components/global-shortcuts";
import { useEngineMode, useStatus } from "@/lib/api";
import { groupId, NAV_CLOSED_KEY, navActive, parseClosed, SIDEBAR_STATE_SCRIPT, sidebarOpenFromCookie } from "@/lib/nav";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shorter label for compact groups (the full one is the tooltip). */
  short?: string;
}

interface NavGroupDef {
  label: string;
  items: NavItem[];
  /** Can be folded away; the choice is remembered. */
  collapsible?: boolean;
  /** Two small items per row. */
  compact?: boolean;
}

/** The sidebar. Add a destination with one line in the right group. */
const NAV: NavGroupDef[] = [
  {
    label: "Library",
    items: [
      { href: "/library", label: "All creations", icon: Library },
      { href: "/library?tab=favorites", label: "Favorites", icon: Star },
    ],
  },
  {
    label: "Create",
    items: [
      { href: "/", label: "Home", icon: Home },
      { href: "/assist", label: "Assist", icon: MessageCircle },
      { href: "/image", label: "Image", icon: ImageIcon },
      { href: "/video", label: "Video", icon: Video },
      { href: "/edit", label: "Edit", icon: Wand2 },
      { href: "/inpaint", label: "Inpaint", icon: Brush },
      { href: "/color-grade", label: "Color grading", icon: SlidersHorizontal },
      { href: "/motions", label: "Camera motions", icon: Film },
      { href: "/effects", label: "Effects", icon: Sparkles },
      { href: "/storyboard", label: "Storyboard", icon: GalleryHorizontal },
      { href: "/canvas", label: "Canvas", icon: Network },
      { href: "/apps", label: "Apps", icon: LayoutGrid },
    ],
  },
  {
    label: "Studios",
    items: [
      { href: "/cinema", label: "Cinema Studio", icon: Clapperboard },
      { href: "/lipsync", label: "Lipsync & avatars", icon: Mic2 },
      { href: "/motion-control", label: "Motion control", icon: PersonStanding },
      { href: "/video-edit", label: "Edit video", icon: Scissors },
      { href: "/extend", label: "Extend video", icon: FastForward },
      { href: "/reframe", label: "Reframe", icon: Crop },
      { href: "/video-tools", label: "Video tools", icon: Layers },
      { href: "/elements", label: "Elements", icon: AtSign },
      { href: "/upscale", label: "Upscale", icon: ZoomIn },
      { href: "/audio", label: "Audio", icon: AudioLines },
    ],
    collapsible: true,
  },
  {
    label: "Engine",
    items: [
      { href: "/models", label: "Models", icon: Boxes },
      { href: "/workflows", label: "ComfyUI workflows", short: "Workflows", icon: Workflow },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/status", label: "Project status", short: "Status", icon: ListChecks },
    ],
    collapsible: true,
    compact: true,
  },
];

const NO_SEARCH = new URLSearchParams();

function StatusDot({ ok }: { ok: boolean | undefined }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-subtle-foreground")} />;
}

function Items({ group, pathname, search }: { group: NavGroupDef; pathname: string; search: URLSearchParams }) {
  const hrefs = group.items.map((i) => i.href);
  return group.items.map((item) => {
    const active = navActive(item.href, pathname, search, hrefs);
    return (
      <SidebarMenuItem key={item.href} className={cn(group.compact && "min-w-0")}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={item.label}
          className={cn("h-8 text-[13px] data-[active=true]:font-semibold", group.compact && "h-7 gap-1.5 px-2 text-[12px]")}
        >
          <Link href={item.href} aria-current={active ? "page" : undefined} title={group.compact && item.short ? item.label : undefined}>
            <item.icon />
            <span>{group.compact ? (item.short ?? item.label) : item.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  });
}

/** Query links (`?tab=favorites`) need the search params, which only exist at request time. */
function WithSearch({ group, pathname }: { group: NavGroupDef; pathname: string }) {
  return <Items group={group} pathname={pathname} search={useSearchParams()} />;
}

/** Reads the pathname (runtime data) inside Suspense so routes can still prerender. */
function ActiveItems({ group }: { group: NavGroupDef }) {
  const pathname = usePathname();
  if (!group.items.some((i) => i.href.includes("?"))) return <Items group={group} pathname={pathname} search={NO_SEARCH} />;
  return (
    <Suspense fallback={<Items group={group} pathname={pathname} search={NO_SEARCH} />}>
      <WithSearch group={group} pathname={pathname} />
    </Suspense>
  );
}

function readClosed(): string[] {
  try {
    return typeof window === "undefined" ? [] : parseClosed(localStorage.getItem(NAV_CLOSED_KEY));
  } catch {
    return [];
  }
}

function NavGroup({ group, open, onToggle }: { group: NavGroupDef; open: boolean; onToggle: () => void }) {
  const id = groupId(group.label);
  return (
    <SidebarGroup data-nav-group={id} data-open={open ? "true" : "false"} className="group/nav py-1">
      {group.collapsible ? (
        <SidebarGroupLabel asChild className="text-[11px] font-medium tracking-wide uppercase">
          <button
            type="button"
            data-nav-toggle
            aria-expanded={open}
            aria-controls={`nav-${id}`}
            onClick={onToggle}
            className="w-full cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {group.label}
            <ChevronRight className="ml-auto size-3.5 transition-transform group-data-[open=true]/nav:rotate-90" />
          </button>
        </SidebarGroupLabel>
      ) : (
        <SidebarGroupLabel className="text-[11px] font-medium tracking-wide uppercase">{group.label}</SidebarGroupLabel>
      )}
      <SidebarMenu id={`nav-${id}`} data-nav-items className={cn(group.compact && "grid grid-cols-2 gap-0.5")}>
        <Suspense fallback={<Items group={group} pathname="" search={NO_SEARCH} />}>
          <ActiveItems group={group} />
        </Suspense>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * Inline script that runs while the HTML is parsed: the server always renders the sidebar
 * expanded, this applies the remembered state before the first paint. On the client it renders as
 * inert text/plain (React warns about executable scripts it renders itself).
 */
function SidebarStateScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: SIDEBAR_STATE_SCRIPT }}
    />
  );
}

/** SidebarProvider that starts from the remembered expanded/collapsed state (the shadcn cookie). */
export function SidebarShell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  const [defaultOpen] = useState(() => (typeof document === "undefined" ? true : sidebarOpenFromCookie(document.cookie)));
  return (
    <SidebarProvider defaultOpen={defaultOpen} style={style}>
      {children}
    </SidebarProvider>
  );
}

/** The app frame: sidebar + inset sheet. Used by the studio layout and the root not-found page. */
export function StudioChrome({ children }: { children: React.ReactNode }) {
  return (
    // The shell stays static: the remembered collapsed state is read on the client (and applied
    // before first paint by AppSidebar's inline script), not from cookies() on the server.
    <SidebarShell style={{ "--sidebar-width": "15.5rem", "--sidebar-width-icon": "3.25rem" } as React.CSSProperties}>
      <AppSidebar />
      <SidebarInset className="min-h-svh min-w-0 md:m-0 md:mt-2 md:rounded-none md:rounded-tl-xl md:border-l-[0.5px] md:border-t-[0.5px] md:shadow-[-2px_0_6px_rgba(0,0,0,.02)] md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:mt-2 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:rounded-tl-xl">
        {children}
      </SidebarInset>
      <GlobalShortcuts />
    </SidebarShell>
  );
}

export function AppSidebar() {
  const { resolvedTheme, setTheme } = useTheme();
  const status = useStatus().data;
  const cloud = status && (status.providers.fal?.configured || status.providers.replicate?.configured || status.providers.higgsfield?.configured);
  const comfy = status?.providers.comfyui?.configured;
  const mode = useEngineMode();
  const ready = mode === "open" ? comfy : mode === "cloud" ? cloud : cloud || comfy;
  const [closed, setClosed] = useState(readClosed);
  const toggle = useCallback((id: string) => {
    setClosed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      try {
        localStorage.setItem(NAV_CLOSED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  return (
    <>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader className="pt-3">
          <div className="flex h-9 items-center justify-between gap-2 px-1 group-data-[collapsible=icon]:justify-center">
            <Link href="/" className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
              <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground shadow-soft">
                <Clapperboard className="size-4" />
              </span>
              <span className="font-heading text-[22px] leading-none">Fuobe</span>
            </Link>
            <SidebarTrigger className="text-muted-foreground" />
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="New creation" className="h-8 text-[13px]">
                <Link href="/">
                  <Plus />
                  <span>New creation</span>
                  <span className="ml-auto flex gap-0.5 group-data-[collapsible=icon]:hidden">
                    <Kbd>⌘</Kbd>
                    <Kbd>K</Kbd>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent className="scrollbar-none">
          {NAV.map((group) => {
            const id = groupId(group.label);
            return <NavGroup key={id} group={group} open={!group.collapsible || !closed.includes(id)} onToggle={() => toggle(id)} />;
          })}
        </SidebarContent>
        <SidebarFooter className="gap-1 border-t border-sidebar-border">
          <Link
            href="/settings"
            className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent group-data-[collapsible=icon]:hidden"
          >
            {mode !== "open" && (
              <span className="flex items-center gap-2">
                <StatusDot ok={cloud} /> Cloud models
                <span className="ml-auto">{cloud ? "connected" : "add key"}</span>
              </span>
            )}
            {mode !== "cloud" && (
              <span className="flex items-center gap-2">
                <StatusDot ok={comfy} /> ComfyUI
                <span className="ml-auto">{comfy ? "online" : "offline"}</span>
              </span>
            )}
            {mode !== "both" && (
              <span className="text-[11px] text-subtle-foreground">{mode === "open" ? "Open source only" : "Paid APIs only"}</span>
            )}
            {status && !ready && status.demoMode !== "off" && (
              <span className="mt-0.5 rounded-sm bg-highlight/25 px-1.5 py-0.5 text-[11px] text-highlight-foreground dark:text-highlight">
                Demo mode · placeholder outputs
              </span>
            )}
          </Link>
          <SidebarMenu className="flex-row gap-1 group-data-[collapsible=icon]:flex-col">
            <SidebarMenuItem className="min-w-0 flex-1">
              <SidebarMenuButton
                tooltip="Toggle theme"
                className="h-8 text-[13px]"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              >
                <Sun className="hidden dark:block" />
                <Moon className="dark:hidden" />
                <span className="hidden dark:inline">Light mode</span>
                <span className="dark:hidden">Dark mode</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem className="shrink-0">
              <SidebarMenuButton asChild tooltip="Open source on GitHub" className="h-8 w-8 justify-center p-0 text-[13px]">
                <a href="https://github.com/workingprototype/fuobe" target="_blank" rel="noreferrer" title="Open source on GitHub">
                  <Cpu />
                  <span className="sr-only">Open source on GitHub</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarStateScript />
    </>
  );
}
