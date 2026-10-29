"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * "Make a skill" from anywhere under the studio layout (the result ⋯ menu in the Library, the feeds and the viewer; the
 * Library's bulk bar). The review screen loads the first time it opens, not with every page.
 */
interface SkillBuilderApi {
  /** Draft a skill from these results (Library ids). */
  open: (ids: string[]) => void;
}

const Ctx = createContext<SkillBuilderApi | null>(null);

/** Make a skill from results (null outside the studio layout). */
export const useSkillBuilder = () => useContext(Ctx);

const SkillBuilder = dynamic(() => import("./skill-builder").then((m) => m.SkillBuilder), { ssr: false });

export function SkillBuilderProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[] | null>(null);
  // After a menu has closed and handed focus back, so the dialog keeps it.
  const open = useCallback((list: string[]) => void setTimeout(() => list.length && setIds([...new Set(list)]), 0), []);
  const api = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {ids && <SkillBuilder key={ids.join(",")} ids={ids} onClose={() => setIds(null)} />}
    </Ctx.Provider>
  );
}
