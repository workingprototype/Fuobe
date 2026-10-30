"use client";

import { Search } from "lucide-react";
import { IntentLink } from "@/components/intent-link";
import { useCommandPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** Opens the ⌘K palette: the way to search on a phone, where there's no keyboard shortcut. */
export function SearchButton({ className }: { className?: string }) {
  const palette = useCommandPalette();
  return (
    <Button variant="ghost" size="icon-sm" className={cn("text-muted-foreground", className)} aria-label="Search" aria-haspopup="dialog" onClick={() => palette.setOpen(true)}>
      <Search />
    </Button>
  );
}

/** The phone header of gallery and settings pages: the menu, the wordmark (home) and search. Hidden from md up, where the sidebar shows. */
export function PhoneBar({ className }: { className?: string }) {
  return (
    <div className={cn("sticky top-0 z-20 flex h-12 items-center gap-1.5 bg-background/85 px-3 backdrop-blur md:hidden", className)}>
      <SidebarTrigger />
      <IntentLink href="/" eager className="rounded-md px-1 font-heading text-[20px] leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Fuobe
      </IntentLink>
      <SearchButton className="ml-auto" />
    </div>
  );
}
