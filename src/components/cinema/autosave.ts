/**
 * A debounced save that never drops the last edit: `schedule` saves a moment after the last change,
 * `flush` saves what's pending right away (on unmount, when the tab is hidden, when the page goes
 * away — then with `keepalive` so the request outlives the page). Pure, so it's tested without a DOM.
 */
export class Autosaver<T> {
  private pending: { value: T } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private save: (value: T, opts: { keepalive: boolean }) => void,
    private readonly delay: number,
  ) {}

  /** Swap in the latest save function (it closes over fresh props). */
  setSave(save: (value: T, opts: { keepalive: boolean }) => void): void {
    this.save = save;
  }

  schedule(value: T): void {
    this.pending = { value };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush(keepalive = false): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const p = this.pending;
    this.pending = null;
    if (p) this.save(p.value, { keepalive });
  }

  /** Forget a pending save (the value was replaced from elsewhere). */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  get dirty(): boolean {
    return this.pending !== null;
  }
}
