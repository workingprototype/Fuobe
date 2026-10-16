"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Suspense } from "react";
import {
  AtSign,
  Layers,
  Crop,
  FastForward,
  Brush,
  AudioLines,
  Boxes,
  Clapperboard,
  Cpu,
  Film,
  Home,
  ImageIcon,
  LayoutGrid,
  ListChecks,
  Mic2,
  Moon,
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
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Kbd } from "@/components/ui/kbd";
import { useEngineMode, useStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  {
    label: "Create",
    items: [
      { href: "/", label: "Home", icon: Home },
      { href: "/image", label: "Image", icon: ImageIcon },
      { href: "/video", label: "Video", icon: Video },
      { href: "/edit", label: "Edit", icon: Wand2 },
      { href: "/inpaint", label: "Inpaint", icon: Brush },
      { href: "/color-grade", label: "Color grading", icon: SlidersHorizontal },
      { href: "/motions", label: "Camera motions", icon: Film },
      { href: "/effects", label: "Effects", icon: Sparkles },
      { href: "/apps", label: "Apps", icon: LayoutGrid },
    ],
  },
  {
    label: "Studios",
    items: [
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
  },
  {
    label: "Library",
    items: [
      { href: "/library", label: "All creations", icon: Library },
      { href: "/library?tab=favorites", label: "Favorites", icon: Star },
    ],
  },
  {
    label: "Engine",
    items: [
      { href: "/models", label: "Models", icon: Boxes },
      { href: "/workflows", label: "ComfyUI workflows", icon: Workflow },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/status", label: "Project status", icon: ListChecks },
    ],
  },
];

function StatusDot({ ok }: { ok: boolean | undefined }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-subtle-foreground")} />;
}

function NavGroups({ pathname }: { pathname: string }) {
  return NAV.map((group) => (
    <SidebarGroup key={group.label} className="py-1">
      <SidebarGroupLabel className="text-[11px] font-medium uppercase tracking-wide">{group.label}</SidebarGroupLabel>
      <SidebarMenu>
        {group.items.map((item) => {
          const [path, query] = item.href.split("?");
          const active = !!pathname && !query && (path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`));
          return (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton asChild isActive={active} tooltip={item.label} className="h-8 text-[13px] data-[active=true]:font-semibold">
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  ));
}

/** Reads the pathname (runtime data) inside Suspense so routes can still prerender. */
function ActiveNav() {
  return <NavGroups pathname={usePathname()} />;
}

export function AppSidebar() {
  const { resolvedTheme, setTheme } = useTheme();
  const status = useStatus().data;
  const cloud = status && (status.providers.fal?.configured || status.providers.replicate?.configured || status.providers.higgsfield?.configured);
  const comfy = status?.providers.comfyui?.configured;
  const mode = useEngineMode();
  const ready = mode === "open" ? comfy : mode === "cloud" ? cloud : cloud || comfy;

  return (
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
        <Suspense fallback={<NavGroups pathname="" />}>
          <ActiveNav />
        </Suspense>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
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
        <SidebarMenu>
          <SidebarMenuItem>
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
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Open source" className="h-8 text-[13px]">
              <a href="https://github.com/workingprototype/fuobe" target="_blank" rel="noreferrer">
                <Cpu />
                <span>Open source on GitHub</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
