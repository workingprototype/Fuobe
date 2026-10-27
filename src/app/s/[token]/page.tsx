import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { SharePage, ShareSkeleton } from "../share-page";
import { previewImage, SHARE_VIEW_HEADER } from "@/lib/share";
import { findShare } from "@/server/share-access";
import { buildPublicShare, recordView } from "@/server/shares";

/** The share and its page, once per request (metadata and the page both read it). */
const load = cache((token: string) => {
  const row = findShare(token);
  const built = row ? buildPublicShare(row, token) : null;
  return row && built ? { id: row.id, page: built.page } : null;
});

/** Never indexed, never cached by a search engine, and no Referer (it would carry the token) to links. */
const PRIVATE: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
  referrer: "no-referrer",
};

/** The address this page was opened at (a link preview needs a full URL for its picture). */
async function requestBase(): Promise<URL | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host");
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() === "https" ? "https" : "http";
  return host && /^[\w.-]+(:\d+)?$|^\[[\da-f:.]+\](:\d+)?$/i.test(host) ? new URL(`${proto}://${host}`) : null;
}

export async function generateMetadata({ params }: PageProps<"/s/[token]">): Promise<Metadata> {
  const { token } = await params;
  // A link opens per request (it may expire or be revoked any minute): never prerendered.
  await connection();
  const s = load(token);
  if (!s) return { ...PRIVATE, title: { absolute: "Link unavailable · Fuobe" } };
  // The cover as the link preview's picture (Slack, iMessage…), at this address (share-scoped, like every file).
  const image = previewImage(s.page.cover);
  const base = await requestBase();
  const preview = image && base;
  return {
    ...PRIVATE,
    ...(base && { metadataBase: base }),
    title: { absolute: `${s.page.title} · Fuobe` },
    description: s.page.description || `${s.page.items.length === 1 ? "A piece" : `${s.page.items.length} pieces`} shared with a read-only link.`,
    openGraph: { title: s.page.title, ...(s.page.description && { description: s.page.description }), type: "website", ...(preview && { images: [image] }) },
    twitter: { card: preview ? "summary_large_image" : "summary", title: s.page.title },
  };
}

async function Content({ params }: { params: PageProps<"/s/[token]">["params"] }) {
  const { token } = await params;
  await connection();
  const s = load(token);
  if (!s) notFound();
  // Views count visitors opening the page, as the sign-in proxy tells them apart: not the owner
  // checking their own link, a HEAD, a prefetch or a link-preview bot (lib/share countsAsView).
  if ((await headers()).get(SHARE_VIEW_HEADER) === "1") recordView(s.id);
  return <SharePage share={s.page} />;
}

/**
 * A share link's public page. The sign-in proxy lets exactly this path (and the share's files)
 * through without a session, after checking the token; an unknown, revoked or expired one gets a
 * real 404 there (src/app/s/gone), before this page streams.
 */
export default function Page({ params }: PageProps<"/s/[token]">) {
  return (
    <Suspense fallback={<ShareSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
