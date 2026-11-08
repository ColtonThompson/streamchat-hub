/**
 * tests/main/twitch-activity.test.ts
 *
 * Poll/prediction events -> cards and feed rows; the EventSub connection against a fake Twitch
 * (subscribing, keepalive, reconnect, revocation); that sign-in never silently drops an earlier
 * permission; and when the message bus watches your channel and what reaches the screen.
 */
import { EventEmitter } from 'node:events'
import { scenario } from '../helpers/scenario'

await scenario('Twitch polls & predictions, EventSub, sign-in permissions, message bus', async (check) => {
  const realST = globalThis.setTimeout
  const wait = (ms: number) => new Promise((r) => realST(r, ms))
  const tick = () => wait(5)

  const { parseActivityEvent, ACTIVITY_EVENTS } = await import('../../src/main/twitch/activity')
  const A = await import('../../src/renderer/src/lib/activity')
  const { EventSubClient } = await import('../../src/main/twitch/eventsub')

  // ================================================================== parser
  const base = { broadcaster_user_id: '42', broadcaster_user_login: 'PixelWitch', broadcaster_user_name: 'PixelWitch' }
  const poll = (extra: object = {}) => ({ ...base, id: 'poll1', title: 'Which game?', choices: [{ id: 'c1', title: 'Zelda', votes: 30, channel_points_votes: 20, bits_votes: 0 }, { id: 'c2', title: 'Mario', votes: 70, channel_points_votes: 10, bits_votes: 0 }], bits_voting: { is_enabled: false, amount_per_vote: 0 }, channel_points_voting: { is_enabled: true, amount_per_vote: 100 }, started_at: '2026-11-07T08:00:00Z', ends_at: '2026-11-07T08:05:00Z', ...extra })
  const pb = parseActivityEvent('channel.poll.begin', poll())!
  check('poll begin: live state', pb.activity.kind === 'poll' && pb.activity.id === 'poll1' && pb.activity.status === 'active' && pb.activity.channelId === 'pixelwitch' && pb.activity.choices[1].votes === 70 && pb.activity.endsAt === Date.parse('2026-11-07T08:05:00Z') && pb.activity.startedAt === Date.parse('2026-11-07T08:00:00Z'), pb.activity)
  check('poll begin: feed row', pb.row?.event?.type === 'poll' && pb.row.event.title === 'Poll started: “Which game?” — Zelda · Mario' && pb.row.platform === 'twitch' && pb.row.channelId === 'pixelwitch' && pb.row.id === 'activity-poll-poll1-begin', pb.row)
  const pp = parseActivityEvent('channel.poll.progress', poll())!
  check('poll progress: card only, no row', pp.row === undefined && pp.activity.status === 'active')
  const pe = parseActivityEvent('channel.poll.end', poll({ status: 'completed', ended_at: '2026-11-07T08:05:00Z' }))!
  check('poll end: result row', pe.activity.status === 'completed' && pe.activity.endedAt === Date.parse('2026-11-07T08:05:00Z') && pe.activity.kind === 'poll' && pe.activity.endsAt === undefined && pe.row?.event?.title === 'Poll ended: “Which game?” — Mario won with 70% (70 of 100 votes)', pe.row?.event)
  check('poll end: terminated says ended early', parseActivityEvent('channel.poll.end', poll({ status: 'terminated' }))!.row?.event?.title?.startsWith('Poll ended early:') === true)
  check('poll end: archived', parseActivityEvent('channel.poll.end', poll({ status: 'archived' }))!.row?.event?.title === 'Poll archived: “Which game?”')
  check('poll end: tie + no votes wording', /tie between Zelda and Mario \(5 votes each\)/.test(parseActivityEvent('channel.poll.end', poll({ status: 'completed', choices: [{ id: 'a', title: 'Zelda', votes: 5 }, { id: 'b', title: 'Mario', votes: 5 }] }))!.row!.event!.title) && /no votes were cast/.test(parseActivityEvent('channel.poll.end', poll({ status: 'completed', choices: [{ id: 'a', title: 'Zelda', votes: 0 }] }))!.row!.event!.title))
  check('poll: votes fall back to the parts when `votes` is missing', (parseActivityEvent('channel.poll.progress', poll({ choices: [{ id: 'a', title: 'x', channel_points_votes: 4, bits_votes: 1 }] }))!.activity as any).choices[0].votes === 5)
  check('poll end: unknown status treated as completed', parseActivityEvent('channel.poll.end', poll({ status: 'weird' }))!.activity.status === 'completed')

  const pred = (extra: object = {}) => ({ ...base, id: 'pred1', title: 'Will I win?', outcomes: [
    { id: 'o1', title: 'Yes', color: 'blue', users: 10, channel_points: 3000, top_predictors: [{ user_id: '1', user_login: 'a', user_name: 'Alice', channel_points_won: null, channel_points_used: 1000 }] },
    { id: 'o2', title: 'No', color: 'pink', users: 5, channel_points: 1000, top_predictors: [] }], started_at: '2026-11-07T09:00:00Z', locks_at: '2026-11-07T09:02:00Z', ...extra })
  const rb = parseActivityEvent('channel.prediction.begin', pred())!
  check('prediction begin', rb.activity.kind === 'prediction' && rb.activity.status === 'active' && rb.activity.locksAt === Date.parse('2026-11-07T09:02:00Z') && rb.activity.outcomes[0].points === 3000 && rb.activity.outcomes[0].topPredictors[0].name === 'Alice' && rb.activity.outcomes[0].topPredictors[0].pointsWon === undefined && rb.row?.event?.title === 'Prediction started: “Will I win?” — Yes vs No', rb)
  check('prediction progress: card only', parseActivityEvent('channel.prediction.progress', pred())!.row === undefined)
  const rl = parseActivityEvent('channel.prediction.lock', pred({ locked_at: '2026-11-07T09:02:00Z' }))!
  check('prediction lock', rl.activity.kind === 'prediction' && rl.activity.status === 'locked' && rl.activity.locksAt === undefined && rl.row?.event?.title === 'Prediction locked: “Will I win?” — no more predictions' && rl.row.timestamp === Date.parse('2026-11-07T09:02:00Z'), rl)
  const winnerOutcomes = pred().outcomes.map((o, i) => (i === 0 ? { ...o, top_predictors: [{ user_name: 'Alice', user_login: 'a', channel_points_used: 1000, channel_points_won: 1333 }] } : o))
  const re = parseActivityEvent('channel.prediction.end', pred({ status: 'resolved', winning_outcome_id: 'o1', ended_at: '2026-11-07T09:10:00Z', outcomes: winnerOutcomes }))!
  check('prediction resolved', re.activity.kind === 'prediction' && re.activity.status === 'resolved' && re.activity.winningOutcomeId === 'o1' && re.activity.outcomes[0].topPredictors[0].pointsWon === 1333 && re.row?.event?.title === 'Prediction resolved: “Will I win?” — Yes won', re)
  const rc = parseActivityEvent('channel.prediction.end', pred({ status: 'canceled', ended_at: '2026-11-07T09:10:00Z' }))!
  check('prediction canceled', rc.activity.kind === 'prediction' && rc.activity.status === 'canceled' && rc.activity.winningOutcomeId === undefined && rc.row?.event?.title === 'Prediction canceled: “Will I win?” — points refunded', rc)
  check('junk is survivable', parseActivityEvent('channel.poll.begin', null) === undefined && parseActivityEvent('channel.poll.begin', {}) === undefined && parseActivityEvent('channel.nope', poll()) === undefined && parseActivityEvent('channel.prediction.end', { id: 'x' })?.activity.kind === 'prediction')
  check('all 7 event names are handled', ACTIVITY_EVENTS.length === 7 && ACTIVITY_EVENTS.every((t) => parseActivityEvent(t, poll()) !== undefined || parseActivityEvent(t, pred()) !== undefined))

  // ================================================================== card helpers
  const pa = pb.activity as any
  const pr = A.pollRows(pa)
  check('pollRows: percentages, total, leader', pr.total === 100 && pr.rows[0].pct === 30 && pr.rows[1].pct === 70 && !pr.rows[0].leading && pr.rows[1].leading, pr)
  check('pollRows: no votes = 0% and no leader', A.pollRows({ ...pa, choices: pa.choices.map((c: any) => ({ ...c, votes: 0 })) }).rows.every((r: any) => r.pct === 0 && !r.leading))
  check('pollRows: tie -> both lead', A.pollRows({ ...pa, choices: pa.choices.map((c: any) => ({ ...c, votes: 5 })) }).rows.every((r: any) => r.leading))
  const qr = A.predictionRows(re.activity as any)
  check('predictionRows: share, payout, winner', qr.totalPoints === 4000 && qr.totalUsers === 15 && qr.rows[0].pct === 75 && qr.rows[1].pct === 25 && qr.rows[0].payout === '1.3x' && qr.rows[1].payout === '4.0x' && qr.rows[0].winner && !qr.rows[1].winner, qr)
  check('predictionRows: nothing bet on a side -> "-"; big payouts have no decimals', A.predictionRows({ ...(rb.activity as any), outcomes: [{ ...(rb.activity as any).outcomes[0], points: 0 }, { ...(rb.activity as any).outcomes[1], points: 5000 }] }).rows[0].payout === '-' && A.predictionRows({ ...(rb.activity as any), outcomes: [{ ...(rb.activity as any).outcomes[0], points: 100 }, { ...(rb.activity as any).outcomes[1], points: 5000 }] }).rows[0].payout === '51x')
  check('canceled prediction has no winner', A.predictionRows(rc.activity as any).rows.every((r: any) => !r.winner))
  check('countdown formats', A.countdown(83_000, 0) === '1:23' && A.countdown(3_725_000, 0) === '1:02:05' && A.countdown(1000, 5000) === '' && A.countdown(undefined, 0) === '' && A.countdown(500, 0) === '0:01')
  check('status texts', A.pollStatusText(pa, Date.parse('2026-11-07T08:04:00Z')) === 'Voting · 1:00' && A.pollStatusText(pe.activity as any, 0) === 'Final results' && A.pollStatusText({ ...pa, status: 'terminated' }, 0) === 'Ended early' && A.predictionStatusText(rb.activity as any, Date.parse('2026-11-07T09:01:00Z')) === 'Open · locks in 1:00' && A.predictionStatusText(rl.activity as any, 0).startsWith('Locked') && A.predictionStatusText(rc.activity as any, 0).startsWith('Canceled'))
  const endAt = Date.parse('2026-11-07T08:05:00Z')
  check('visibility: active shown; result shown for 2 min then hidden; stale poll hidden', A.activityVisible(pa, endAt - 1000) && A.activityVisible(pe.activity, endAt + 60_000) && !A.activityVisible(pe.activity, endAt + 121_000) && !A.activityVisible(pa, endAt + 130_000) && A.activityVisible(rl.activity, Date.now() + 86_400_000), 'x')
  check('needsClock: countdowns and results yes; locked prediction no', A.needsClock(pa) && A.needsClock(pe.activity) && A.needsClock(rb.activity) && !A.needsClock(rl.activity))

  // ================================================================== EventSub client against a fake Twitch
  class FakeSocket extends EventEmitter {
    closed = false
    constructor(public url: string) { super() }
    close() { this.closed = true }
    terminate() { this.closed = true; this.emit('close', 1006) }
  }
  const msg = (type: string, payload: object = {}, extraMeta: object = {}) => JSON.stringify({ metadata: { message_id: Math.random().toString(36), message_type: type, message_timestamp: new Date().toISOString(), ...extraMeta }, payload })
  const welcome = (s: FakeSocket, id: string, ka = 10) => s.emit('message', msg('session_welcome', { session: { id, status: 'connected', keepalive_timeout_seconds: ka, reconnect_url: null } }))
  const notify = (s: FakeSocket, type: string, event: object, id?: string) => s.emit('message', JSON.stringify({ metadata: { message_id: id ?? Math.random().toString(36), message_type: 'notification', subscription_type: type }, payload: { subscription: { type }, event } }))

  function harness(opts: { subscribe?: (t: string, id: string) => Promise<{ ok: boolean; error?: string }> } = {}) {
    const sockets: FakeSocket[] = [], subs: [string, string][] = [], events: [string, any][] = [], states: any[] = []
    const client = new EventSubClient({
      types: ['t.a', 't.b', 't.c'],
      createSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s as any },
      subscribe: opts.subscribe ?? (async (t, id) => { subs.push([t, id]); return { ok: true } }),
      onNotification: (t, e) => events.push([t, e]),
      onState: (s) => states.push(s)
    })
    return { sockets, subs, events, states, client }
  }

  {
    const h = harness(); h.client.start()
    check('connects to Twitch EventSub and reports connecting', h.sockets.length === 1 && h.sockets[0].url === 'wss://eventsub.wss.twitch.tv/ws' && h.states[0].state === 'connecting')
    welcome(h.sockets[0], 'S1'); await tick()
    check('welcome -> subscribes to every type with the session id; reports connected', h.subs.map((s) => s.join('@')).join() === 't.a@S1,t.b@S1,t.c@S1' && h.states.at(-1).state === 'connected', { subs: h.subs, states: h.states })
    notify(h.sockets[0], 't.a', { n: 1 }, 'm1'); notify(h.sockets[0], 't.a', { n: 1 }, 'm1'); notify(h.sockets[0], 't.b', { n: 2 }, 'm2')
    h.sockets[0].emit('message', msg('session_keepalive'))
    h.sockets[0].emit('message', 'not json'); h.sockets[0].emit('message', JSON.stringify([1, 2]))
    check('notifications routed; duplicate message id dropped; keepalive/junk ignored', h.events.length === 2 && h.events[0][0] === 't.a' && h.events[1][1].n === 2, h.events)
    h.client.stop()
    notify(h.sockets[0], 't.a', { n: 3 }, 'm3')
    check('stop(): socket closed, nothing delivered afterwards', h.sockets[0].closed && h.events.length === 2)
  }

  // Everything below uses shortened timers (keepalive, backoff): 200x faster.
  ;(globalThis as any).setTimeout = (fn: any, ms?: number, ...a: any[]) => realST(fn, (ms ?? 0) / 200, ...a)
  {
    const h = harness(); h.client.start()
    welcome(h.sockets[0], 'S1', 0); await tick() // keepalive limit = 0 s + 3 s slack (shrunk to 15 ms)
    await wait(240)
    check('silence beyond the keepalive limit -> connection dropped and re-opened', h.sockets[0].closed && h.sockets.length >= 2 && h.states.some((s) => s.state === 'connecting'), { sockets: h.sockets.length })
    welcome(h.sockets[1], 'S2', 10); await tick()
    check('after a reconnect it subscribes again on the NEW session', h.subs.filter((s) => s[1] === 'S2').length === 3 && h.states.at(-1).state === 'connected')
    h.client.stop()
  }
  {
    const h = harness(); h.client.start(); welcome(h.sockets[0], 'S1'); await tick()
    const before = h.subs.length
    h.sockets[0].emit('message', msg('session_reconnect', { session: { id: 'S1', status: 'reconnecting', keepalive_timeout_seconds: null, reconnect_url: 'wss://moved.example/ws?x=1' } }))
    check('session_reconnect opens the URL exactly as given, old socket stays open', h.sockets.length === 2 && h.sockets[1].url === 'wss://moved.example/ws?x=1' && !h.sockets[0].closed)
    notify(h.sockets[0], 't.a', { n: 'during move' }, 'x1')
    check('old socket still delivers while the move is in progress', h.events.length === 1)
    welcome(h.sockets[1], 'S1-new', 10); await tick()
    check('move done: old socket closed, NOT re-subscribed, new socket delivers', h.sockets[0].closed && h.subs.length === before && (notify(h.sockets[1], 't.b', { n: 'after' }, 'x2'), h.events.length === 2))
    h.sockets[1].emit('close', 1006); await wait(120)
    check('the moved-to socket dropping later still reconnects normally', h.sockets.length === 3)
    h.client.stop()
  }
  {
    let calls = 0
    const h = harness({ subscribe: async () => (++calls <= 3 ? { ok: false, error: 'Twitch refused: enable polls' } : { ok: true }) }); h.client.start()
    welcome(h.sockets[0], 'S1'); await tick()
    check('every subscription refused -> readable error, retrying, socket dropped', h.states.at(-1).state === 'error' && /enable polls/.test(h.states.at(-1).message) && h.states.at(-1).retrying === true && h.sockets[0].closed, h.states.at(-1))
    await wait(120)
    check('...and it tries again by itself', h.sockets.length === 2)
    welcome(h.sockets[1], 'S2'); await tick()
    check('...and recovers when the problem is gone', h.states.at(-1).state === 'connected')
    h.client.stop()
  }
  {
    const h = harness({ subscribe: async (t) => (t === 't.b' ? { ok: false, error: 'nope' } : { ok: true }) }); h.client.start(); welcome(h.sockets[0], 'S1'); await tick()
    check('partial failure still counts as connected', h.states.at(-1).state === 'connected')
    h.client.stop()
  }
  {
    const h = harness({ subscribe: async () => { throw new Error('network down') } }); h.client.start(); welcome(h.sockets[0], 'S1'); await tick()
    check('subscribe throwing is handled like a refusal', h.states.at(-1).state === 'error' && /network down/.test(h.states.at(-1).message))
    h.client.stop()
  }
  {
    const h = harness(); h.client.start(); welcome(h.sockets[0], 'S1'); await tick()
    h.sockets[0].emit('message', msg('revocation', { subscription: { status: 'authorization_revoked', type: 't.a' } }))
    const n = h.sockets.length; await wait(160)
    check('revocation -> error (not retrying), connection closed, no reconnect', h.states.at(-1).state === 'error' && h.states.at(-1).retrying === false && /authorization revoked/.test(h.states.at(-1).message) && h.sockets[0].closed && h.sockets.length === n)
  }
  {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const h = harness({ subscribe: async () => { await gate; return { ok: true } } }); h.client.start(); welcome(h.sockets[0], 'S1'); await tick()
    h.client.stop(); release(); await tick()
    check('stop() while subscribing: late results are ignored', !h.states.some((s) => s.state === 'connected'))
  }
  {
    const h = harness(); h.client.start(); welcome(h.sockets[0], 'S1'); await tick()
    h.sockets[0].emit('close', 1006); await wait(120)
    check('plain connection drop -> reconnects', h.sockets.length === 2)
    h.client.stop(); const n = h.sockets.length; await wait(120)
    check('after stop() no further reconnects', h.sockets.length === n)
  }
  ;(globalThis as any).setTimeout = realST

  // ================================================================== sign-in scopes (no silent drop of an earlier permission)
  {
    const { TwitchAuth } = await import('../../src/main/twitch/auth')
    const requested: string[] = []
    let granted = ''
    ;(globalThis as any).fetch = async (url: any, init?: any) => {
      const u = String(url)
      const json = (o: object, status = 200) => new Response(JSON.stringify(o), { status })
      if (u.endsWith('/device')) { requested.push(init.body.get('scopes')); granted = init.body.get('scopes'); return json({ device_code: 'd', user_code: 'U', verification_uri: 'https://x', expires_in: 60, interval: 0 }) }
      if (u.endsWith('/token')) return json({ access_token: 'tok', refresh_token: 'ref', expires_in: 3600 })
      if (u.endsWith('/validate')) return json({ user_id: '42', login: 'pixelwitch', expires_in: 3600, scopes: granted.split(' ') })
      return json({})
    }
    const auth = new TwitchAuth()
    await auth.login({})
    check('plain sign-in asks only for chat', requested[0] === 'user:write:chat' && !auth.canModerate && !auth.canReadPolls, requested)
    await auth.login({ polls: true })
    check('enable polls: adds the two read scopes', requested[1] === 'user:write:chat channel:read:polls channel:read:predictions' && auth.canReadPolls && !auth.canModerate && auth.getState().canReadPolls === true && auth.loginName === 'pixelwitch', requested[1])
    await auth.login({ moderation: true })
    check('enable moderation LATER keeps polls', requested[2].includes('moderator:manage:banned_users') && requested[2].includes('channel:read:polls') && auth.canModerate && auth.canReadPolls, requested[2])
    await auth.login({ polls: true })
    check('re-requesting polls keeps moderation', requested[3].includes('moderator:manage:chat_messages') && auth.canModerate, requested[3])
    await auth.logout()
    await auth.login({ moderation: true })
    check('after sign-out the old tiers are NOT carried over', requested[4] === 'user:write:chat moderator:manage:chat_messages moderator:manage:banned_users' && !auth.canReadPolls, requested[4])
  }

  // ================================================================== the bus: when to watch, what reaches the screen
  {
    const WS = (await import('ws')).default as any
    const { MessageBus } = await import('../../src/main/bus')
    const posts: any[] = []
    let subscribeStatus = 202
    ;(globalThis as any).fetch = async (url: any, init?: any) => {
      const u = String(url)
      if (u.includes('/eventsub/subscriptions')) { posts.push({ body: JSON.parse(init.body), headers: init.headers }); return subscribeStatus === 202 ? new Response('{}', { status: 202 }) : new Response(JSON.stringify({ message: 'denied' }), { status: subscribeStatus }) }
      if (u.includes('/chat/badges')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      return new Response('{}', { status: 404 })
    }
    const listeners = new Set<(s: any) => void>()
    const fakeAuth: any = {
      clientId: 'cid', userId: '42', loginName: 'pixelwitch', canReadPolls: true, canModerate: false,
      getState: () => ({ status: 'signed-in', configured: true }),
      onChange: (cb: any) => { listeners.add(cb); return () => listeners.delete(cb) },
      getAccessToken: async () => 'tok', refresh: async () => true
    }
    const sent: any[] = []
    const win: any = { isDestroyed: () => false, webContents: { send: (ch: string, payload: any) => sent.push([ch, payload]) } }
    const bus = new MessageBus(win, fakeAuth)
    const esSockets = () => WS.instances.filter((s: any) => s.url.includes('eventsub'))
    const openEs = () => esSockets().filter((s: any) => !s.closed)

    await bus.setEnabled('twitch', true, ['someoneelse'])
    check("someone else's channel only: no poll connection", esSockets().length === 0)
    bus.setChannels('twitch', ['someoneelse', 'pixelwitch'])
    check('your own channel added: connection starts', openEs().length === 1)
    bus.setChannels('twitch', ['someoneelse'])
    check('your own channel removed: connection stops', openEs().length === 0 && esSockets()[0].closed)
    fakeAuth.canReadPolls = false
    bus.setChannels('twitch', ['pixelwitch'])
    check('own channel but no polls permission: nothing', esSockets().length === 1)
    fakeAuth.canReadPolls = true; listeners.forEach((cb) => cb({}))
    check('permission granted (sign-in state changes): starts', openEs().length === 1)
    listeners.forEach((cb) => cb({})); bus.setChannels('twitch', ['pixelwitch'])
    check('repeated triggers do not open extra connections', openEs().length === 1 && esSockets().length === 2)

    const es = openEs()[0]
    sent.length = 0 // only look at what happens from here on: the "Watching..." notice and the poll rows
    welcome(es, 'SES'); await wait(60)
    check('subscribes 7 events for YOUR user id, on this session, with your token', posts.length === 7 && posts.every((p) => p.body.condition.broadcaster_user_id === '42' && p.body.transport.method === 'websocket' && p.body.transport.session_id === 'SES' && p.body.version === '1' && p.headers.Authorization === 'Bearer tok' && p.headers['Client-Id'] === 'cid') && new Set(posts.map((p) => p.body.type)).size === 7, posts.map((p) => p.body.type))

    notify(es, 'channel.poll.begin', poll())
    for (let i = 0; i < 3; i++) notify(es, 'channel.poll.progress', poll({ choices: [{ id: 'c1', title: 'Zelda', votes: i }, { id: 'c2', title: 'Mario', votes: 1 }] }))
    notify(es, 'channel.poll.end', poll({ status: 'completed', ended_at: '2026-11-07T08:05:00Z' }))
    await wait(300)
    const items = sent.filter(([ch]) => ch === 'chat:batch').flatMap(([, p]) => p)
    const acts = items.filter((i: any) => i.kind === 'activity'), rows = items.filter((i: any) => i.kind === 'message')
    check('rapid updates for one poll are coalesced into its latest state', acts.length === 1 && acts[0].activity.status === 'completed', acts.map((a: any) => a.activity.status))
    check('feed rows: connected notice, poll start, poll end', rows.map((r: any) => r.message.event.type).join() === 'notice,poll,poll' && rows[0].message.event.title === 'Watching your polls & predictions', rows.map((r: any) => r.message.event.title))

    sent.length = 0
    notify(es, 'channel.prediction.begin', pred()); await wait(240)
    const items2 = sent.filter(([ch]) => ch === 'chat:batch').flatMap(([, p]) => p)
    check('a prediction reaches the UI as card + row', items2.some((i: any) => i.kind === 'activity' && i.activity.kind === 'prediction' && i.activity.status === 'active') && items2.some((i: any) => i.kind === 'message' && i.message.event.type === 'prediction'))

    bus.setEnabled('twitch', false, [])
    await wait(10)
    check('Twitch switched off: connection closed', openEs().length === 0)

    // refusal path: one readable notice, not one per retry
    subscribeStatus = 403
    sent.length = 0
    await bus.setEnabled('twitch', true, ['pixelwitch'])
    const es2 = openEs()[0]; welcome(es2, 'S9'); await wait(300)
    const notices = sent.filter(([ch]) => ch === 'chat:batch').flatMap(([, p]) => p).filter((i: any) => i.kind === 'message' && /unavailable/.test(i.message.event.title))
    check('refused by Twitch -> one readable "unavailable" row', notices.length === 1 && /enable polls & predictions/i.test(notices[0].message.event.title), notices.map((n: any) => n.message.event.title))
    bus.dispose()
  }

})
