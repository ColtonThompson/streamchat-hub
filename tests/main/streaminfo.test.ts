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
    const out: (Info | null)[] = []
    let viewers = 10
    let fail = false
    const calls: string[] = []
    const w = new StreamInfoWatcher({
      fetch: async (t) => {
        calls.push(t.source)
        if (fail) throw new Error('network')
        return { ...t, live: true, title: `T-${t.source}`, viewers }
      },
      onInfo: (i) => out.push(i),
      intervalMs: 30
    })
    w.watch(tw('a'))
    await wait(10)
    check('fetches right away and reports it', out.at(-1)?.viewers === 10 && out.at(-1)?.title === 'T-a', out)
    await wait(70)
    const n = out.length
    check('an unchanged result is not reported again', out.length === n && calls.length >= 3 && out.filter((x) => x !== null).length === 1, { out: out.length, calls: calls.length })
    viewers = 25
    await wait(50)
    check('a changed viewer count is reported', out.at(-1)?.viewers === 25)
    fail = true
    await wait(50)
    check('a failing fetch keeps the last info (nothing reported)', out.at(-1)?.viewers === 25)
    fail = false
    w.watch(tw('b'))
    check('switching streams clears the old info at once', out.at(-1) === null)
    await wait(10)
    check('...then shows the new stream', out.at(-1)?.source === 'b' && out.at(-1)?.title === 'T-b')
    const calls0 = calls.length
    w.watch(tw('b'))
    await wait(5)
    check('watching the same stream again does nothing', calls.length === calls0)
    w.watch(null)
    check('no target: info cleared', out.at(-1) === null && w.current === null)
    const c1 = calls.length
    await wait(90)
    check('...and nothing is fetched any more', calls.length === c1)
    w.stop()
  }
  {
    // A slow answer for the PREVIOUS stream must not show up on the new one.
    const out: (Info | null)[] = []
    let release: (() => void) | undefined
    const w = new StreamInfoWatcher({
      fetch: async (t) => {
        if (t.source === 'slow') await new Promise<void>((r) => (release = r))
        return { ...t, live: true, title: t.source }
      },
      onInfo: (i) => out.push(i),
      intervalMs: 10_000
    })
    w.watch(tw('slow'))
    w.watch(tw('fast'))
    await wait(10)
    release?.()
    await wait(10)
    check('a late reply for an old stream is ignored', out.filter((x) => x).map((x) => x!.source).join() === 'fast', out)
    w.stop()
  }

  // ================================================================== fetcher
  {
    let twitch: unknown = { title: 'Speedrun!', viewers: 1234, game: 'Zelda' }
    const f = makeInfoFetcher({
      twitchStream: async () => twitch as never,
      youtubeStats: async (s) => (s === 'off' ? { live: false, title: 'Old stream' } : { live: true, title: 'Live now', viewers: 55 })
    })
    const live = await f(tw('x'))
    check('Twitch live -> title, viewers, category', live?.live === true && live.title === 'Speedrun!' && live.viewers === 1234 && live.game === 'Zelda', live)
    twitch = null
    check('Twitch offline -> not live, no numbers', JSON.stringify(await f(tw('x'))) === JSON.stringify({ platform: 'twitch', source: 'x', live: false }))
    twitch = undefined
    const signedOut = await f(tw('x'))
    check('Twitch while signed out -> an explanation', signedOut?.live === false && /sign in/i.test(signedOut.note ?? ''), signedOut)
    twitch = { title: 'T', viewers: 1, game: '' }
    check('empty category is left out', (await f(tw('x')))?.game === undefined)
    const yt = await f({ platform: 'youtube', source: '@a123' })
    check('YouTube live -> title + viewers', yt?.live === true && yt.title === 'Live now' && yt.viewers === 55)
    const ytOff = await f({ platform: 'youtube', source: 'off' })
    check('YouTube offline -> no title, no viewers', ytOff?.live === false && ytOff.title === undefined && ytOff.viewers === undefined, ytOff)
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
