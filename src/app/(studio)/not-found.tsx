import { NotFoundState } from "@/components/empty-state";

/** Shown inside the app shell when a studio page calls notFound() (unknown app, element…). */
export default function NotFound() {
  return <NotFoundState />;
}
