/**
 * tests/helpers/scenario.ts
 *
 * WHY THIS EXISTS: some behaviour only makes sense as a story in time ("YouTube goes live, the chat is
 * polled, one poll fails, the stream comes back..."). Such a story runs once, with fake timers and a fake
 * network, and many things are true at the end. `scenario()` runs the story first, collecting named
 * checks, and then registers ONE vitest test per check, so the report still names exactly what broke.
 *
 *   await scenario('YouTube adapter', async (check) => {
 *     ...run the story...
 *     check('messages arrive once', msgs.length === 3, msgs)   // name, passed?, details shown on failure
 *   })
 *
 * If the story itself throws, an extra failing test shows the error.
 */
import { describe, expect, it } from 'vitest'

export type Check = (name: string, ok: boolean, detail?: unknown) => void

const show = (v: unknown): string => {
  try {
    return JSON.stringify(v)?.slice(0, 600) ?? String(v)
  } catch {
    return String(v)
  }
}

export async function scenario(title: string, story: (check: Check) => Promise<void> | void): Promise<void> {
  const results: { name: string; ok: boolean; detail?: unknown }[] = []
  let crash: unknown
  try {
    await story((name, ok, detail) => void results.push({ name, ok, detail }))
  } catch (err) {
    crash = err
  }
  describe(title, () => {
    for (const r of results) {
      it(r.name, () => {
        expect(r.ok, r.ok ? '' : `${r.name} -> ${show(r.detail)}`).toBe(true)
      })
    }
    if (crash) {
      it('the scenario ran to the end', () => {
        throw crash
      })
    }
  })
}
