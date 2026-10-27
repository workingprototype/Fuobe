import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ModelAccessView } from "@/components/model-access-view";
import { PageHeader, PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Models & licences" };

/** Settings → Models & licences: every model's licence as information, and the switches that decide what this install offers. */
export default function Page() {
  return (
    <PageShell>
      <Link href="/settings" className="mb-3 inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Settings
      </Link>
      <PageHeader
        title="Models & licences"
        description={
          <>
            Every model, LoRA and node pack Fuobe can run, with its licence: paid and open, commercial or not. Licences are information here; you decide what this install offers. Everything is on until
            you switch it off, and what is off leaves every picker and is refused on the server.{" "}
            <Link href="/settings/about" className="text-brand-text underline-offset-2 hover:underline">
              About &amp; licences
            </Link>{" "}
            has the notices and the full licence texts of the open models.
          </>
        }
      />
      <ModelAccessView />
    </PageShell>
  );
}
