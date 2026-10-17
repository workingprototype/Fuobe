import { StudioChrome } from "@/components/app-sidebar";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <StudioChrome>{children}</StudioChrome>;
}
