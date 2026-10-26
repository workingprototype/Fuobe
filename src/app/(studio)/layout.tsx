import { StudioChrome } from "@/components/app-sidebar";
import { ShareProvider } from "@/components/share/share-provider";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudioChrome>
      <ShareProvider>{children}</ShareProvider>
    </StudioChrome>
  );
}
