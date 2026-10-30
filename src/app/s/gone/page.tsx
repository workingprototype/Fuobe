import type { Metadata } from "next";
import { ShareGone } from "../share-page";

export const metadata: Metadata = { title: { absolute: "Link unavailable · Fuobe" }, robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Where the proxy sends a share link that doesn't work (with a 404): no studio chrome, no way in. */
export default function Page() {
  return <ShareGone />;
}
