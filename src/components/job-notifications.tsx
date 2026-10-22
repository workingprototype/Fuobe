"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { anotherTabVisible, keepStreamWhileHidden, leadsStream, useGenerationEvents, useRunningGenerations } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import {
  dueJobs,
  longestRunning,
  notificationText,
  runningJobs,
  seedWatch,
  SETTLE_MS,
  shouldNotify,
  shouldOffer,
  titleWithCount,
  watchEvent,
  type FinishedJob,
  type WatchState,
} from "@/lib/job-watch";
import { notificationPermission, notificationsEnabled, useNotificationPrefs } from "@/lib/notification-prefs";

/** The result viewer is its own chunk: it loads when a notification is clicked. */
const Viewer = dynamic(() => import("@/components/studio/viewer").then((m) => m.Viewer));

/**
 * Jobs in the background, for every page in the app frame: the number running in the tab title
 * ("(2) Library · Fuobe"), a one-time offer to turn on notifications once a job runs a while, and
 * a system notification when a job finishes or fails while nobody is looking at Fuobe. Only the
 * tab that reads the live stream for the browser (its leader) notifies, so tabs don't repeat it;
 * clicking the notification brings that tab forward and opens the result. The decisions are pure
 * (src/lib/job-watch.ts).
 */
export function JobNotifications() {
  const router = useRouter();
  const running = useRunningGenerations();
  const prefs = useNotificationPrefs();
  const [shown, setShown] = useState<Generation | null>(null);
  const watch = useRef<WatchState>({});
  const latest = useRef(prefs);
  useEffect(() => {
    latest.current = prefs;
  });

  // ---- the tab title: "(2) …" while jobs run
  const count = runningJobs(running.data ?? []);
  useEffect(() => {
    const apply = () => {
      const next = titleWithCount(document.title, count);
      if (next !== document.title) document.title = next;
    };
    apply();
    // Next sets the title again on every navigation: put the count back in front.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = titleWithCount(document.title, 0);
    };
  }, [count]);

  // ---- finished jobs → a notification (leader tab, nobody looking)
  const open = useCallback(
    async (job: FinishedJob) => {
      window.focus();
      if (job.outcome === "failed") {
        const { title, body } = notificationText(job);
        toast.error(title, { description: body, action: { label: "Open Library", onClick: () => router.push("/library") } });
        return;
      }
      try {
        const res = await fetch(`/api/generations/${job.generation.id}`);
        const g = res.ok ? ((await res.json()) as Generation) : null;
        if (g?.outputs.length) setShown(g);
        else router.push("/library");
      } catch {
        router.push("/library");
      }
    },
    [router],
  );

  const notify = useCallback(
    async (job: FinishedJob) => {
      if (!notificationsEnabled() || !leadsStream() || document.visibilityState !== "hidden") return;
      const otherVisible = await anotherTabVisible();
      const ok = shouldNotify({
        enabled: notificationsEnabled(),
        permission: notificationPermission(),
        leader: leadsStream(),
        hidden: document.visibilityState === "hidden",
        otherVisible,
      });
      if (!ok) return;
      const { title, body } = notificationText(job);
      try {
        // The tag replaces rather than repeats one job's notification (and dedupes tabs that each read their own stream).
        const n = new Notification(title, { body, tag: `fuobe-${job.key}`, icon: "/favicon.ico" });
        n.onclick = () => {
          n.close();
          void open(job);
        };
      } catch {
        // Some mobile browsers only notify from a service worker: the tab title still shows it.
      }
    },
    [open],
  );

  const check = useCallback(() => {
    const now = Date.now();
    const { state, done } = dueJobs(watch.current, now);
    watch.current = state;
    for (const job of done) void notify(job);
    const p = latest.current;
    if (shouldOffer({ permission: p.permission, enabled: p.enabled, asked: p.asked, visible: document.visibilityState === "visible", runningFor: longestRunning(state, now) })) {
      p.markAsked();
      toast("Want a heads-up when it’s done?", {
        id: "notify-offer",
        description: "Fuobe can send a notification when a job finishes while you’re in another tab or app.",
        duration: 15_000,
        action: {
          label: "Notify me",
          onClick: () =>
            void p.setEnabled(true).then((on) =>
              on ? toast.success("Notifications are on", { description: "Change it any time in Settings → Notifications." }) : toast("Notifications are blocked in this browser", { description: "Allow them in the site settings, then turn them on in Settings." }),
            ),
        },
        cancel: { label: "Not now", onClick: () => {} },
      });
    }
  }, [notify]);

  useGenerationEvents((ev) => {
    const before = watch.current;
    watch.current = watchEvent(before, ev, Date.now());
    // A job just went quiet: look again once it has settled (a timer started now isn't held back much in a background tab).
    if (watch.current !== before && Object.values(watch.current).some((j) => j.quietSince != null && before[j.key]?.quietSince == null)) setTimeout(check, SETTLE_MS + 100);
  });

  // Jobs already running when the page opened are watched too.
  useEffect(() => {
    if (running.data) watch.current = seedWatch(watch.current, running.data, Date.now());
  }, [running.data]);

  // While something runs: settle checks and the offer, every couple of seconds.
  const busy = count > 0;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(check, 2000);
    return () => clearInterval(t);
  }, [busy, check]);

  // Hidden for a while, a tab lets go of the stream; with notifications on it keeps listening while a job runs.
  useEffect(() => {
    keepStreamWhileHidden(() => notificationsEnabled() && Object.values(watch.current).some((j) => j.quietSince == null));
    return () => keepStreamWhileHidden(null);
  }, []);

  return shown ? <Viewer generation={shown} index={0} onClose={() => setShown(null)} /> : null;
}
