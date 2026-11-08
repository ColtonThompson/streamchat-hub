/**
 * tests/main/livewatch.test.ts
 *
 * The followed-channels watcher: what is announced (and what is not), recovery from errors,
 * the live list that feeds the Twitch box, and stopping when permission is lost.
 */
import { scenario } from '../helpers/scenario'

await scenario('Go-live watcher: announcements', async (check) => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const { LiveWatcher } = await import('../../src/main/livewatch')

  const S = (id: string, over: object = {}) => ({ userId: id, login: 'login' + id, name: 'Name' + id, game: 'Hades II', title: 'cozy run', live: true, ...over })
  function make(over: object = {}) {
    let result: any = []; const calls: any[] = []; const out: any[] = []; let t = 0
    const w = new LiveWatcher({ fetchLive: async () => { calls.push(1); if (result instanceof Error) throw result; return result }, announce: (a: any) => out.push(a), selfId: () => 'me', intervalMs: 20, rememberMs: 100, now: () => t, ...over })
    return { w, out, calls, set: (r: any) => (result = r), time: (n: number) => (t = n) }
  }

  // baseline: already-live streams are not announced
  { const m = make(); m.set([S('1'), S('2')]); m.w.start(); await wait(5)
    check('first poll is a baseline: nothing announced', m.out.length === 0)
    m.set([S('1'), S('2'), S('3', { game: 'Celeste', title: 'any%' })]); await wait(60)
    check('new channel announced with game + title + link', m.out.length === 1 && m.out[0].title === 'Name3 is live' && m.out[0].body === 'Playing Celeste · any%' && m.out[0].url === 'https://www.twitch.tv/login3', m.out)
    await wait(120); check('not announced again while it stays live', m.out.length === 1)
    m.w.stop() }

  // wording without game / title
  { const m = make(); m.set([]); m.w.start(); await wait(5)
    m.set([S('1', { game: '', title: 'just chatting vibes' }), S('2', { game: '', title: '' }), S('3', { game: 'Hades II', title: '' })]); await wait(60)
    check('no game -> title; nothing -> fallback; game only', m.out.map((o) => o.body).join('|') === 'just chatting vibes|Just went live|Playing Hades II', m.out)
    m.w.stop() }

  // skips self, non-live
  { const m = make(); m.set([]); m.w.start(); await wait(5)
    m.set([S('me'), S('5', { live: false })]); await wait(60)
    check('own channel and non-live entries are skipped', m.out.length === 0); m.w.stop() }

  // flapping
  { const m = make(); m.set([]); m.w.start(); await wait(5)
    m.time(0); m.set([S('7')]); await wait(60); const first = m.out.length
    m.set([]); m.time(50); await wait(60)
    m.set([S('7')]); m.time(60); await wait(60)
    check('quick drop-and-return is not re-announced', first === 1 && m.out.length === 1, m.out.length)
    m.set([]); m.time(500); await wait(60)   // forgotten after rememberMs
    m.set([S('7')]); m.time(520); await wait(60)
    check('after being gone a long time it is announced again', m.out.length === 2, m.out.length); m.w.stop() }

  // burst -> summary
  { const m = make(); m.set([]); m.w.start(); await wait(5)
    m.set([S('1'), S('2'), S('3'), S('4'), S('5')]); await wait(60)
    check('more than 3 at once -> one summary', m.out.length === 1 && m.out[0].title === '5 channels you follow went live' && m.out[0].body === 'Name1, Name2, Name3 and 2 more' && !m.out[0].url, m.out)
    m.w.stop() }
  { const m = make(); m.set([]); m.w.start(); await wait(5)
    m.set([S('1'), S('2'), S('3')]); await wait(60)
    check('exactly 3 -> three separate notifications', m.out.length === 3); m.w.stop() }

  // errors
  { const m = make(); m.set([S('1')]); m.w.start(); await wait(5)
    m.set(new Error('offline')); await wait(100)
    check('network error: keeps polling', m.w.active && m.calls.length >= 3, m.calls.length)
    m.set([S('1'), S('9')]); await wait(60)
    check('recovers and announces what it missed', m.out.length === 1 && m.out[0].title === 'Name9 is live', m.out); m.w.stop() }
  { const m = make(); m.set(Object.assign(new Error('forbidden'), { status: 403 })); m.w.start(); await wait(120)
    check('403 stops polling', !m.w.active && m.calls.length === 1, m.calls.length) }
  { const m = make(); m.set(undefined); m.w.start(); await wait(100)
    check('signed out (undefined): quiet, keeps polling', m.out.length === 0 && m.w.active); m.w.stop() }

  // stop / restart
  { const m = make(); m.set([S('1')]); m.w.start(); await wait(5); m.w.stop(); const n = m.calls.length; await wait(120)
    check('stop halts polling', m.calls.length === n && !m.w.active)
    m.set([S('1'), S('2')]); m.w.start(); await wait(5)
    check('restart re-baselines (no announcements)', m.out.length === 0); m.w.stop() }
  { const m = make(); m.set([]); m.w.start(); m.w.start(); await wait(5); check('double start is one loop', m.calls.length === 1); m.w.stop() }
})

await scenario('Go-live watcher: live list for the Twitch box', async (check) => {
  const { LiveWatcher } = await import('../../src/main/livewatch')
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // watcher: onList + alertsOn
  const S = (id: string, over: object = {}) => ({ userId: id, login: 'l' + id, name: 'N' + id, game: 'G', title: 't', viewers: 1, live: true, ...over })
  { let result: any = []; const lists: any[] = []; const out: any[] = []; let alerts = false
    const w = new LiveWatcher({ fetchLive: async () => result, announce: (a: any) => out.push(a), onList: (l: any) => lists.push(l.map((s: any) => s.userId)), alertsOn: () => alerts, selfId: () => 'me', intervalMs: 20 })
    result = [S('1'), S('5', { live: false })]; w.start(); await wait(5)
    check('onList: only live entries, even on the baseline check', JSON.stringify(lists.at(-1)) === '["1"]', lists)
    result = [S('1'), S('2')]; await wait(60)
    check('alerts off: list updates but no notification', JSON.stringify(lists.at(-1)) === '["1","2"]' && out.length === 0, { lists, out })
    alerts = true; result = [S('1'), S('2'), S('3')]; await wait(60)
    check('alerts on: only the newly live one is announced (2 was already known)', out.length === 1 && out[0].title === 'N3 is live', out)
    w.stop()
    check('stop publishes an empty list', JSON.stringify(lists.at(-1)) === '[]')
    const n = lists.length; w.stop(); check('second stop is silent', lists.length === n) }
  { const lists: any[] = []
    const w = new LiveWatcher({ fetchLive: async () => { throw Object.assign(new Error('no'), { status: 403 }) }, announce: () => {}, onList: (l: any) => lists.push(l.length), selfId: () => 'me', intervalMs: 20 })
    w.start(); await wait(80)
    check('permission lost (403): watcher stops and clears the list', !w.active && lists.at(-1) === 0, lists) }
  { const lists: any[] = []
    const w = new LiveWatcher({ fetchLive: async () => undefined, announce: () => {}, onList: (l: any) => lists.push(l.length), selfId: () => 'me', intervalMs: 20 })
    w.start(); await wait(10); w.stop()
    check('signed out: empty list', lists.every((n) => n === 0) && lists.length >= 1) }
})
