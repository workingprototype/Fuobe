import type { Metadata } from "next";
import { StudioChrome } from "@/components/app-sidebar";
import { NotFoundState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Not found" };

/** Unknown URLs anywhere in the app: the branded state inside the usual app frame. */
export default function NotFound() {
  return (
    <StudioChrome>
      <NotFoundState />
    </StudioChrome>
  );
}
