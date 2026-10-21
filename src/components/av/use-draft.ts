"use client";

import { useCallback, useState } from "react";

/**
 * Text being typed into a field that also follows a value from outside (a cue's time shown as
 * "1:02.5"): the draft resets whenever the outside value changes, without an effect.
 */
export function useDraft(source: string): [string, (v: string) => void, () => void] {
  const [state, setState] = useState({ source, draft: source });
  let current = state;
  if (state.source !== source) {
    current = { source, draft: source };
    setState(current);
  }
  const set = useCallback((draft: string) => setState((s) => ({ ...s, draft })), []);
  const reset = useCallback(() => setState((s) => ({ ...s, draft: s.source })), []);
  return [current.draft, set, reset];
}
