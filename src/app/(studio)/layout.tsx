import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { GlobalShortcuts } from "@/components/global-shortcuts";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "15.5rem", "--sidebar-width-icon": "3.25rem" } as React.CSSProperties}
    >
      <AppSidebar />
      <SidebarInset className="min-h-svh md:m-0 md:mt-2 md:rounded-none md:rounded-tl-xl md:border-l-[0.5px] md:border-t-[0.5px] md:shadow-[-2px_0_6px_rgba(0,0,0,.02)] md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:mt-2 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:rounded-tl-xl">
        {children}
      </SidebarInset>
      <GlobalShortcuts />
    </SidebarProvider>
  );
}
