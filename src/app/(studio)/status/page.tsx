import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Project status" };

async function readStatus(): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), "docs", "STATUS.md"), "utf8");
  } catch {
    return "# Project status\n\ndocs/STATUS.md is missing.";
  }
}

export default async function Page() {
  const md = await readStatus();
  return (
    <PageShell>
      <article className="prose-fuobe max-w-3xl">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
      </article>
    </PageShell>
  );
}
