/**
 * main/adapters/twitch/gifts.ts
 *
 * WHAT: Prevents a "gift 20 subs" action from flooding the feed with 21 rows.
 *
 * THE PROBLEM: When someone gifts many subs at once, Twitch sends ONE summary notice
 *   ("X is gifting 20 subs!") followed by 20 separate "X gifted a sub to Y" notices. All of them carry
 *   the same `msg-param-origin-id`. We show the summary and skip the individual notices.
 *
 * HOW IT WORKS: When a summary arrives we remember its origin id for 10 minutes. Any single-gift notice
 *   whose origin id we remember is considered part of that bomb and is dropped.
 *
 * HOW IT FITS: used by adapters/twitch/index.ts in the USERNOTICE branch.
 */

/** How long we remember a gift bomb. Long enough to cover all of its follow-up notices. */
const TTL_MS = 10 * 60_000

export class GiftBombFilter {
  /** origin id -> time (ms) after which we forget it. */
  private bombs = new Map<string, number>()

  /** Record that a summary notice with this origin id was seen. `now` is a parameter only so tests can fake the clock. */
  note(originId: string, now = Date.now()): void {
    for (const [id, expires] of this.bombs) if (expires < now) this.bombs.delete(id) // tidy up old entries
    this.bombs.set(originId, now + TTL_MS)
  }

  /** True if a single-gift notice with this origin id belongs to a bomb we've already summarised. */
  isPartOfBomb(originId: string | undefined, now = Date.now()): boolean {
    if (!originId) return false
    const expires = this.bombs.get(originId)
    return expires !== undefined && expires >= now
  }
}
