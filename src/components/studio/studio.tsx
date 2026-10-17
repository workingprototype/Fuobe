import type { ComponentProps } from "react";
import { studioCatalog } from "@/lib/studio-catalog";
import { StudioPage } from "./studio-page";

/**
 * Server entry for a studio page: picks the models this studio needs on the server and passes
 * them down, so the browser never loads the full model catalog. Use it from `page.tsx`:
 * `<Studio config={VIDEO_STUDIO} />`.
 */
export function Studio(props: Omit<ComponentProps<typeof StudioPage>, "catalog">) {
  return <StudioPage {...props} catalog={studioCatalog(props.config)} />;
}
