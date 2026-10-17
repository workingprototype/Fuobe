import { HomeView } from "@/components/home-view";
import { APPS, EFFECTS, MOTIONS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-cards";

const HOME_MOTIONS = ["motion-crash-zoom-in", "motion-360-orbit", "motion-bullet-time", "motion-fpv-drone", "motion-dolly-zoom-in", "motion-snorricam"];

/** The catalog stays on the server: the home view gets 18 slim cards and three counts. */
export default function Page() {
  return (
    <HomeView
      counts={{ motions: MOTIONS.length, effects: EFFECTS.length, apps: APPS.length }}
      motions={MOTIONS.filter((m) => HOME_MOTIONS.includes(m.id)).map(toPresetCard)}
      apps={APPS.slice(0, 12)
        .filter((a) => a.badges?.includes("top") || a.category === "Camera")
        .slice(0, 6)
        .map(toPresetCard)}
      effects={EFFECTS.slice(0, 6).map(toPresetCard)}
    />
  );
}
