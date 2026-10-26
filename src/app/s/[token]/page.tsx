import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { SharePage, ShareSkeleton } from "@/components/share/share-page";
import { authEnabled, SESSION_COOKIE, validSession } from "@/server/auth";
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

export async function generateMetadata({ params }: PageProps<"/s/[token]">): Promise<Metadata> {
  const { token } = await params;
  // A link opens per request (it may expire or be revoked any minute): never prerendered.
  await connection();
  const s = load(token);
  if (!s) return { ...PRIVATE, title: { absolute: "Link unavailable · Fuobe" } };
  return {
    ...PRIVATE,
    title: { absolute: `${s.page.title} · Fuobe` },
    description: s.page.description || `${s.page.items.length === 1 ? "A piece" : `${s.page.items.length} pieces`} shared with a read-only link.`,
    openGraph: { title: s.page.title, ...(s.page.description && { description: s.page.description }), type: "website" },
  };
}

async function Content({ params }: { params: PageProps<"/s/[token]">["params"] }) {
  const { token } = await params;
  await connection();
  const s = load(token);
  if (!s) notFound();
  // Views count visitors, not the owner checking their own link.
  const jar = await cookies();
  if (!(authEnabled() && validSession(jar.get(SESSION_COOKIE)?.value))) recordView(s.id);
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
