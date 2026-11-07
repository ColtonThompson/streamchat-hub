/**
 * main/adapters/youtube/pacer.ts
 *
 * WHAT: Spreads a burst of messages out over time.
 *
 * WHY: YouTube hands us everything that arrived since the last poll in one lump every few seconds.
 *   Showing that lump instantly makes chat feel jerky ("nothing... nothing... 12 messages at once").
 *   The pacer releases them one by one across roughly the poll interval, like YouTube's own chat window.
 *
 * It keeps ORDER (items leave in the order they were pushed, including deletions relative to messages)
 * and never delays more than 250 ms between items. A `span` of 0 releases everything immediately
 * (used for the history shown when you first join).
 */
export class Pacer<T> {
  private queue: T[] = []
  private timer?: NodeJS.Timeout
  private gap = 0

  constructor(private out: (item: T) => void) {}

  /** Queue items to be released over about `spanMs` milliseconds. */
  push(items: T[], spanMs: number): void {
    if (!items.length) return
    this.queue.push(...items)
    this.gap = Math.min(250, Math.max(0, spanMs / this.queue.length))
    this.drain()
  }

  /** Drop anything still waiting and cancel the timer. */
  stop(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.queue = []
  }

  private drain(): void {
    if (this.timer) return // already releasing; the running timer will pick up the new items
    while (this.queue.length) {
      this.out(this.queue.shift() as T)
      if (this.gap > 0 && this.queue.length) {
        this.timer = setTimeout(() => {
          this.timer = undefined
          this.drain()
        }, this.gap)
        return
      }
    }
  }
}
