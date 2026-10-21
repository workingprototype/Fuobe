import { PROJECT_SWATCH, type AssistProject } from "@/lib/assist";
import { cn } from "@/lib/utils";

/** A project's colour dot (sidebar rows, pickers, breadcrumbs). */
export function ProjectDot({ project, className }: { project: Pick<AssistProject, "color">; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: PROJECT_SWATCH[project.color] }} />;
}
