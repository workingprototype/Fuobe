import { SidebarTrigger } from "@/components/ui/sidebar";

/** Scrollable page body for non-studio pages (galleries, settings, library). */
export function PageShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-svh flex-col">
      <div className="sticky top-0 z-20 flex h-12 items-center px-3 md:hidden">
        <SidebarTrigger />
      </div>
      <div className={`mx-auto w-full flex-1 px-4 pt-4 pb-16 sm:px-8 md:pt-12 ${wide ? "max-w-[1400px]" : "max-w-[1200px]"}`}>{children}</div>
    </div>
  );
}
