/** Paging state for lists rendered a page at a time (components/use-progressive.ts). Pure. */
export interface ProgressiveState {
  /** The filter/search the count belongs to: a new one starts from the first page again. */
  key: string;
  shown: number;
}

export const progressiveStart = (key: string, first: number): ProgressiveState => ({ key, shown: first });

/** The same state while the filter is unchanged; the first page again once it changes. */
export const syncProgressive = (state: ProgressiveState, key: string, first: number): ProgressiveState =>
  state.key === key ? state : progressiveStart(key, first);

/** How many items show after one more page. */
export const pageAfter = (shown: number, page: number) => shown + Math.max(1, page);
