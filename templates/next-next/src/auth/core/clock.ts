/** Time source. Injected so expiry behavior is testable (conformance `advanceClock`). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock that only moves when told to. For tests and conformance drivers. */
export class ManualClock implements Clock {
  private current: number;
  constructor(start: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.current = start.getTime();
  }
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

export const MINUTE_MS = 60_000;
