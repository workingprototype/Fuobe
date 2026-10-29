import { StudioChrome } from "@/components/app-sidebar";
import { ShareProvider } from "@/components/share/share-provider";
import { SkillBuilderProvider } from "@/components/skills/skill-builder-provider";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudioChrome>
      <ShareProvider>
        <SkillBuilderProvider>{children}</SkillBuilderProvider>
      </ShareProvider>
    </StudioChrome>
  );
}
