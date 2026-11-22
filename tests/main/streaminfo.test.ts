/**
 * tests/main/streaminfo.test.ts
 *
 * The watcher that keeps the single stream's title and viewers fresh, the fetchers that turn Twitch / YouTube
 * answers into StreamInfo, and reading YouTube's watch page.
 */
import type { StreamInfo as Info } from '../../src/shared/types'
import { scenario } from '../helpers/scenario'

function tw(login: string) {
  return { platform: 'twitch' as const, source: login }
}

await scenario('Stream info (title and viewers)', async (check) => {
  const { StreamInfoWatcher, makeInfoFetcher } = await import('../../src/main/streaminfo')
  const { parseWatchStats } = await import('../../src/main/adapters/youtube/innertube')
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // ================================================================== watcher
  {
    const out: Info[][] = []
    let viewers = 10
    let fail = false
    let rounds = 0
    const seen: string[][] = []
    const w = new StreamInfoWatcher({
      fetch: async (ts) => {
        rounds++
        seen.push(ts.map((t) => t.source))
        if (fail) return ts.map(() => new Error('network down'))
        return ts.map((t) => ({ ...t, live: true, title: `T-${t.source}`, viewers }))
      },
      onInfo: (i) => out.push(i),
      intervalMs: 30
    })
    w.watch([tw('a'), tw('b')])
    await wait(10)
    check('checks every channel right away', out.at(-1)?.length === 2 && out.at(-1)?.[1].title === 'T-b' && seen[0].join() === 'a,b', out)
    await wait(70)
    check('unchanged results are not reported again', out.length === 1 && rounds >= 3, { out: out.length, rounds })
    viewers = 25
    await wait(50)
    check('a changed viewer count is reported', out.at(-1)?.[0].viewers === 25)
    fail = true
    await wait(25)
    check('one failed round keeps the last info untouched', out.at(-1)?.[0].viewers === 25 && !out.at(-1)?.[0].stale, out.at(-1))
    await wait(60)
    check('repeated failures mark it stale with the reason', out.at(-1)?.[0].stale === true && /network down/.test(out.at(-1)?.[0].note ?? '') && out.at(-1)?.[0].viewers === 25, out.at(-1))
    fail = false
    await wait(50)
    check('and it recovers on the next good check', out.at(-1)?.[0].stale === undefined && out.at(-1)?.[0].viewers === 25, out.at(-1))
    w.watch([tw('b')])
    check('a removed channel disappears at once', out.at(-1)?.length === 1 && out.at(-1)?.[0].source === 'b', out.at(-1))
    const r0 = rounds
    w.watch([tw('b')])
    await wait(5)
    check('watching the same list again does nothing', rounds === r0)
    w.watch([])
    check('no channels: cleared', out.at(-1)?.length === 0 && w.current.length === 0)
    const r1 = rounds
    await wait(90)
    check('...and nothing is fetched any more', rounds === r1)
    w.stop()
  }
  {
    // refresh() looks again right now; a slow reply for an OLD list is ignored.
    const out: Info[][] = []
    let n = 0
    const w = new StreamInfoWatcher({
      fetch: async (ts) => {
        n++
        return ts.map((t) => ({ ...t, live: n > 1, title: `round ${n}` }))
      },
      onInfo: (i) => out.push(i),
      intervalMs: 10_000
    })
    w.watch([tw('x')])
    await wait(10)
    check('first check: offline baseline', out.at(-1)?.[0].live === false)
    await w.refresh()
    check('refresh() checks right now (went live)', out.at(-1)?.[0].live === true && n === 2, out.at(-1))
    w.stop()
    let release: (() => void) | undefined
    const out2: Info[][] = []
    const w2 = new StreamInfoWatcher({
      fetch: async (ts) => {
        if (ts[0].source === 'slow') await new Promise<void>((r) => (release = r))
        return ts.map((t) => ({ ...t, live: true, title: t.source }))
      },
      onInfo: (i) => out2.push(i),
      intervalMs: 10_000
    })
    w2.watch([tw('slow')])
    w2.watch([tw('fast')])
    await wait(10)
    release?.()
    await wait(10)
    check('a late reply for an old list is ignored, the new list is still checked', out2.flat().map((x) => x.source).join() === 'fast', out2)
    w2.stop()
  }

  // ================================================================== fetcher
  {
    let twitch: Map<string, { title: string; viewers: number; game: string }> | undefined = new Map([['x', { title: 'Speedrun!', viewers: 1234, game: 'Zelda' }]])
    let calls = 0
    const f = makeInfoFetcher({
      twitchStreams: async () => {
        calls++
        return twitch
      },
      youtubeStats: async (s) => {
        if (s === 'boom') throw new Error('HTTP 429')
        return s === 'off' ? { live: false, title: 'Old stream' } : { live: true, title: 'Live now', viewers: 55 }
      }
    })
    const [live, other] = (await f([tw('x'), tw('y')])) as Info[]
    check('Twitch live -> title, viewers, category', live.live === true && live.title === 'Speedrun!' && live.viewers === 1234 && live.game === 'Zelda', live)
    check('...a channel not in the answer is offline, from ONE request', JSON.stringify(other) === JSON.stringify({ platform: 'twitch', source: 'y', live: false }) && calls === 1, other)
    twitch = undefined
    const [signedOut] = (await f([tw('x')])) as Info[]
    check('Twitch while signed out -> an explanation', signedOut.live === false && /sign in/i.test(signedOut.note ?? ''), signedOut)
    twitch = new Map([['x', { title: 'T', viewers: 1, game: '' }]])
    check('empty category is left out', ((await f([tw('x')])) as Info[])[0].game === undefined)
    const [yt, ytOff, ytBad] = await f([{ platform: 'youtube', source: '@a123' }, { platform: 'youtube', source: 'off' }, { platform: 'youtube', source: 'boom' }])
    check('YouTube live -> title + viewers', (yt as Info).live === true && (yt as Info).title === 'Live now' && (yt as Info).viewers === 55)
    check('YouTube offline -> no title, no viewers', (ytOff as Info).live === false && (ytOff as Info).title === undefined && (ytOff as Info).viewers === undefined, ytOff)
    check('one YouTube failure is an Error for that channel only', ytBad instanceof Error && /429/.test(ytBad.message) && !(yt instanceof Error))
    const failing = makeInfoFetcher({ twitchStreams: async () => { throw new Error('HTTP 401') }, youtubeStats: async () => ({ live: false }) })
    const [t1, y1] = await failing([tw('x'), { platform: 'youtube', source: '@a123' }])
    check('a Twitch failure is an Error and does not stop YouTube', t1 instanceof Error && !(y1 instanceof Error))
  }

  // ================================================================== YouTube watch page
  {
    const page = (viewBlock: string, live = true) => `<html><meta property="og:title" content="Tom &amp; Jerry LIVE"><script>{"videoViewCountRenderer":${viewBlock}}${live ? ',"isLiveNow":true' : ''},"ownerChannelName":"Pixel Witch"</script></html>`
    const a = parseWatchStats(page('{"viewCount":{"runs":[{"text":"1,234"},{"text":" watching now"}]},"isLive":true,"originalViewCount":"1234"}'))
    check('live page: title, viewers from originalViewCount, owner', a.live && a.title === 'Tom & Jerry LIVE' && a.viewers === 1234 && a.owner === 'Pixel Witch', a)
    const b = parseWatchStats(page('{"viewCount":{"simpleText":"2,5 watching now"}}'))
    check('falls back to the "N watching now" text', b.viewers === 25, b)
    const c = parseWatchStats(page('{"viewCount":{"simpleText":"1,000 views"},"originalViewCount":"1000"}', false))
    check('not live: no viewer count (views of an old stream are not "watching")', c.live === false && c.viewers === undefined, c)
    check('empty page is harmless', JSON.stringify(parseWatchStats('<html></html>')) === JSON.stringify({ live: false }))
  }
})
