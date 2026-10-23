"use client";

import { BellRing } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useHydrated } from "@/lib/api";
import { useNotificationPrefs } from "@/lib/notification-prefs";

/** Settings → Notifications: this browser's opt-in for "your job is done" notifications. */
export function NotificationSettings() {
  const id = useId();
  const hydrated = useHydrated();
  const { enabled, permission, setEnabled } = useNotificationPrefs();
  if (!hydrated) return <div className="h-14" aria-hidden />;
  if (permission === "unsupported") {
    return (
      <p className="rounded-lg bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
        This browser can&apos;t show notifications here. Open Fuobe over https:// or on localhost to turn them on. The tab title still shows how many jobs are running.
      </p>
    );
  }
  const blocked = permission === "denied";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          <span className="block text-[13px] font-medium">Tell me when a job is done</span>
          <span className="block text-[12px] leading-snug text-muted-foreground">
            A system notification when a generation or studio job finishes or fails while Fuobe is in the background. Click it to see the result.
          </span>
        </label>
        <Switch
          id={id}
          checked={enabled}
          disabled={blocked}
          onCheckedChange={(v) =>
            void setEnabled(v).then((on) => {
              if (v && !on) toast("Notifications are blocked in this browser", { description: "Allow them in the site settings, then try again." });
            })
          }
        />
      </div>
      {blocked && <p className="text-[12px] text-muted-foreground">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then come back to turn them on.</p>}
      {enabled && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => {
            try {
              new Notification("Notifications are on", { body: "This is how Fuobe tells you a job is done.", tag: "fuobe-test", icon: "/favicon.ico" });
            } catch {
              toast.error("This browser only shows notifications from an installed app");
            }
          }}
        >
          <BellRing className="size-3.5" /> Send a test
        </Button>
      )}
    </div>
  );
}
