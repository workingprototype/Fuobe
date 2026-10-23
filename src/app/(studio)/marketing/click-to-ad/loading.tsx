import { StudioSkeleton } from "@/components/skeletons";

// Its own fallback, so the Marketing gallery's skeleton (../loading.tsx) never stands in for this form.
export default function Loading() {
  return <StudioSkeleton />;
}
