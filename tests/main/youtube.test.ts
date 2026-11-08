/**
 * tests/main/youtube.test.ts
 *
 * YouTube: cleaning what the user types, parsing every kind of chat item, reading the chat page,
 * the pacer that spreads bursts of messages, and the whole adapter run against a fake YouTube
 * (going live, retries, de-duplication after a reconnect, adding/removing streams).
 */
import { scenario } from '../helpers/scenario'

await scenario('YouTube adapter (against a fake YouTube)', async (check) => {
  const { parseYouTubeSources, parseSources, youtubeSourceKind } = await import('../../src/shared/channels')
  const { parseActions, argbToHex, nameColor } = await import('../../src/main/adapters/youtube/parse')
  const inner = await import('../../src/main/adapters/youtube/innertube')
  const { Pacer } = await import('../../src/main/adapters/youtube/pacer')

  // ============================================================ source parsing
  const VID = 'dQw4w9WgXcQ', CH = 'UC' + 'x'.repeat(22)
  check('bare video id', parseYouTubeSources(VID).join() === VID)
  check('video ids keep their case', parseYouTubeSources('AbCdEfGhIjK').join() === 'AbCdEfGhIjK')
  check('watch URL (extra params)', parseYouTubeSources(`https://www.youtube.com/watch?feature=share&v=${VID}&t=30s`).join() === VID)
  check('youtu.be URL', parseYouTubeSources(`youtu.be/${VID}?si=abc`).join() === VID)
  check('/live/ URL', parseYouTubeSources(`https://youtube.com/live/${VID}?feature=share`).join() === VID)
  check('handle lowercased', parseYouTubeSources('@MyChannel').join() === '@mychannel')
  check('handle URL', parseYouTubeSources('https://www.youtube.com/@MyChannel/streams').join() === '@mychannel')
  check('channel id + channel URL', parseYouTubeSources(`${CH} https://youtube.com/channel/${CH}/live`).join() === CH)
  check('handle without @ is dropped', parseYouTubeSources('mychannel').length === 0)
  check('garbage dropped, dupes removed, mix kept', parseYouTubeSources(`nope, ${VID}, ${VID}, @abc, !!!`).join() === `${VID},@abc`)
  check('limit of 5', parseYouTubeSources('@aaa @bbb @ccc @ddd @eee @fff').length === 5)
  check('kinds', youtubeSourceKind(VID) === 'video' && youtubeSourceKind('@abc') === 'handle' && youtubeSourceKind(CH) === 'channel' && youtubeSourceKind('x') === undefined)
  check('parseSources routes by platform', parseSources('twitch', 'Summit1G').join() === 'summit1g' && parseSources('youtube', 'Summit1G').length === 0)

  // ============================================================ message parsing
  const text = (t: string) => ({ text: t })
  const base = (id: string, extra: object = {}) => ({
    id, authorName: { simpleText: 'Pixel Witch' }, authorExternalChannelId: 'UCwitch', timestampUsec: '1790000000123456', ...extra
  })
  const add = (kind: string, r: object) => ({ addChatItemAction: { item: { [kind]: r } } })
  const ctx = (extra: object = {}) => ({ videoId: VID, ...extra })
  const msgOf = (a: unknown) => { const i = parseActions([a], ctx()); return i[0]?.kind === 'message' ? i[0].message : undefined }

  const customEmoji = { emoji: { emojiId: 'UCxx/abc', shortcuts: [':_hugs:'], isCustomEmoji: true, image: { thumbnails: [{ url: 'https://yt3.ggpht.com/s24', width: 24 }, { url: '//yt3.ggpht.com/s48', width: 48 }] } } }
  const m1 = msgOf(add('liveChatTextMessageRenderer', base('m1', {
    message: { runs: [text('hi '), { emoji: { emojiId: '😀' } }, text(' '), customEmoji, text(' see '), { text: 'example.com', navigationEndpoint: { urlEndpoint: { url: 'https://www.youtube.com/redirect?event=live_chat&q=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1' } } }] },
    authorBadges: [
      { liveChatAuthorBadgeRenderer: { icon: { iconType: 'MODERATOR' }, tooltip: 'Moderator' } },
      { liveChatAuthorBadgeRenderer: { customThumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/b16' }, { url: 'https://yt3.ggpht.com/b32' }] }, tooltip: 'Member (6 months)' } }
    ]
  })))!
  check('text msg basics', m1.id === 'm1' && m1.platform === 'youtube' && m1.channelId === VID && m1.author.name === 'Pixel Witch' && m1.author.id === 'UCwitch', m1)
  check('timestamp usec -> ms', m1.timestamp === 1790000000123, m1.timestamp)
  check('unicode emoji is text, merged', m1.parts[0].type === 'text' && (m1.parts[0] as any).value === 'hi 😀 ', m1.parts)
  const em = m1.parts[1] as any
  check('custom emote -> image part, biggest size, https fixed', em.type === 'emote' && em.value === ':_hugs:' && em.url === 'https://yt3.ggpht.com/s48' && em.source === 'youtube', em)
  const lk = m1.parts.find((p) => p.type === 'link') as any
  check('redirect link unwrapped', lk?.url === 'https://example.com/a?b=1' && lk.value === 'example.com', lk)
  check('badges: mod + member image', m1.author.badges.map((b) => b.id).join() === 'moderator,member' && m1.author.badges[1].url === 'https://yt3.ggpht.com/b32' && m1.meta?.isMod === true && m1.meta?.isSub === true, m1.author.badges)
  check('name colour is stable + set', !!m1.author.color && m1.author.color === nameColor('UCwitch'))
  check('no id -> row skipped', msgOf(add('liveChatTextMessageRenderer', { authorName: { simpleText: 'x' }, message: { runs: [text('a')] } })) === undefined)
  check('owner badge = mod flag', msgOf(add('liveChatTextMessageRenderer', base('o1', { message: { runs: [text('a')] }, authorBadges: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'OWNER' } } }] })))?.meta?.isMod === true)

  check('argb -> hex', argbToHex(4279592384) === '#1565c0' && argbToHex('x') === undefined, argbToHex(4279592384))
  const sc = msgOf(add('liveChatPaidMessageRenderer', base('p1', { purchaseAmountText: { simpleText: 'CA$10.00' }, headerBackgroundColor: 4279592384, message: { runs: [text('great stream')] } })))!
  check('super chat', sc.meta?.superChat?.label === 'CA$10.00' && sc.meta.superChat.color === '#1565c0' && (sc.parts[0] as any).value === 'great stream' && !sc.event, sc)
  const st = msgOf(add('liveChatPaidStickerRenderer', base('s1', { purchaseAmountText: { simpleText: '$2.00' }, moneyChipBackgroundColor: 4294947584, sticker: { thumbnails: [{ url: '//x/st' }], accessibility: { accessibilityData: { label: 'Cool cat' } } } })))!
  check('super sticker', st.meta?.superChat?.label === '$2.00' && st.parts[0].type === 'emote' && (st.parts[0] as any).url === 'https://x/st', st)
  const mem = msgOf(add('liveChatMembershipItemRenderer', base('mb1', { headerSubtext: { runs: [text('Welcome to Gold!')] } })))!
  check('new member event', mem.event?.type === 'member' && mem.event.title === 'Pixel Witch became a member. Welcome to Gold!', mem.event)
  const mile = msgOf(add('liveChatMembershipItemRenderer', base('mb2', { headerPrimaryText: { runs: [text('Member for 6 months')] }, headerSubtext: { runs: [text('Gold')] }, message: { runs: [text('thanks!')] } })))!
  check('membership milestone + message', mile.event?.title === 'Pixel Witch: Member for 6 months.' && (mile.parts[0] as any).value === 'thanks!', mile)
  const gift = (n: number) => msgOf(add('liveChatSponsorshipsGiftPurchaseAnnouncementRenderer', { id: 'g' + n, timestampUsec: '1790000000000000', authorExternalChannelId: 'UCg', header: { liveChatSponsorshipsHeaderRenderer: { authorName: { simpleText: 'Big Gifter' }, primaryText: { runs: [text('Sent '), text(String(n)), text(' Chan gift memberships')] } } } }))!
  check('gift of 5 = giftbomb, gift of 1 = subgift', gift(5).event?.type === 'giftbomb' && gift(1).event?.type === 'subgift' && gift(5).event?.title === 'Big Gifter: Sent 5 Chan gift memberships.', gift(5).event)

  // removals + names
  const rm1 = parseActions([{ removeChatItemAction: { targetItemId: 'm1' } }, { markChatItemAsDeletedAction: { targetItemId: 'm2' } }], ctx())
  check('delete actions -> delete-message', rm1.length === 2 && rm1.every((i) => i.kind === 'moderation' && i.action.type === 'delete-message' && i.action.channelId === VID) && (rm1[1] as any).action.messageId === 'm2', rm1)
  const rmU = parseActions([{ removeChatItemByAuthorAction: { externalChannelId: 'UCwitch' } }], ctx({ nameOf: (id: string) => (id === 'UCwitch' ? 'Pixel Witch' : undefined) }))
  check('ban/timeout with known name -> clear-user + note', rmU.length === 2 && (rmU[0] as any).action.type === 'clear-user' && (rmU[0] as any).action.userId === 'UCwitch' && (rmU[1] as any).message.event.type === 'moderation' && (rmU[1] as any).message.event.title.startsWith('Pixel Witch was removed'), rmU)
  const rmU2 = parseActions([{ removeChatItemByAuthorAction: { externalChannelId: 'UCnobody' } }], ctx())
  check('ban/timeout with unknown name -> just clear-user (no note)', rmU2.length === 1 && rmU2[0].kind === 'moderation', rmU2)

  const unknown: string[] = []
  const mixed = parseActions([
    { addLiveChatTickerItemAction: { item: {} } },
    add('liveChatViewerEngagementMessageRenderer', { id: 'e' }),
    add('liveChatPlaceholderItemRenderer', { id: 'ph' }),
    add('someBrandNewRenderer', { id: 'n' }),
    { someBrandNewAction: { x: 1 } },
    add('liveChatTextMessageRenderer', base('after', { message: { runs: [text('still works')] } })),
    { replaceChatItemAction: { targetItemId: 'ph', replacementItem: { liveChatTextMessageRenderer: base('repl', { message: { runs: [text('approved')] } }) } } },
    null, 'junk', 42, {}
  ], ctx({ onUnknown: (k: string) => unknown.push(k) }))
  check('ignored kinds silent, unknown reported, junk survived, replace works', mixed.map((i) => (i as any).message?.id).join() === 'after,repl' && unknown.join() === 'someBrandNewRenderer,someBrandNewAction', { ids: mixed.map((i) => (i as any).message?.id), unknown })
  check('non-array input is fine', parseActions(undefined, ctx()).length === 0 && parseActions('x', ctx()).length === 0)

  // ============================================================ page parsing
  const chatHtml = (data: object, extra = '') =>
    `<html><script>ytcfg.set({"INNERTUBE_API_KEY":"KEY123","INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20260101.00.00"${extra}});</script><script>window["ytInitialData"] = ${JSON.stringify(data)};</script></html>`
  const liveData = { contents: { liveChatRenderer: { continuations: [{ invalidationContinuationData: { continuation: 'TOKEN0', timeoutMs: 3000 } }], actions: [add('liveChatTextMessageRenderer', base('h1', { message: { runs: [text('history')] } }))] } } }
  const sess = inner.parseChatPage(chatHtml(liveData))
  check('chat page -> session', sess.apiKey === 'KEY123' && sess.clientVersion === '2.20260101.00.00' && sess.continuation === 'TOKEN0' && sess.initialActions.length === 1, sess)
  const throwsMsg = (f: () => unknown) => { try { f(); return '' } catch (e) { return (e instanceof inner.ChatUnavailableError ? 'U:' : 'E:') + (e as Error).message } }
  check('replay page rejected as not live', throwsMsg(() => inner.parseChatPage(chatHtml({ contents: { liveChatRenderer: { isReplay: true, continuations: [{ timedContinuationData: { continuation: 'x' } }] } } }))).startsWith('U:this stream is not live'))
  check('chat disabled message', throwsMsg(() => inner.parseChatPage(chatHtml({ contents: { messageRenderer: { text: { runs: [{ text: 'Chat is disabled for this live stream.' }] } } } }))) === 'U:chat is turned off for this stream')
  check('no continuation -> unavailable', throwsMsg(() => inner.parseChatPage(chatHtml({ contents: { liveChatRenderer: { continuations: [] } } }))).startsWith('U:'))
  check('layout change -> plain Error (retried, not permanent)', throwsMsg(() => inner.parseChatPage('<html>nothing</html>')).startsWith('E:'))
  check('timeout clamped to 1..8 s, default 5 s', inner.nextContinuation([{ timedContinuationData: { continuation: 'a', timeoutMs: 50 } }])!.timeoutMs === 1000 && inner.nextContinuation([{ invalidationContinuationData: { continuation: 'a', timeoutMs: 600000 } }])!.timeoutMs === 8000 && inner.nextContinuation([{ reloadContinuationData: { continuation: 'a' } }])!.timeoutMs === 5000)
  check('poll response: ended vs normal', inner.parsePollResponse({}).next === undefined && inner.parsePollResponse({ continuationContents: { liveChatContinuation: { continuations: [{ timedContinuationData: { continuation: 'n', timeoutMs: 2000 } }], actions: [1, 2] } } }).actions.length === 2)

  const livePage = (id: string, live: boolean) => `<html><head><link rel="canonical" href="https://www.youtube.com/watch?v=${id}"><meta property="og:title" content="Tom &amp; Jerry LIVE"></head><script>{"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{${live ? '"isLiveNow":true,' : ''}"startTimestamp":"2026-01-01"}}}}</script></html>`
  check('live page -> id + title', JSON.stringify(inner.parseLivePage(livePage(VID, true))) === JSON.stringify({ videoId: VID, title: 'Tom & Jerry LIVE' }))
  check('old stream (not live now) -> offline', inner.parseLivePage(livePage(VID, false)) === undefined)
  check('channel page (no canonical watch link) -> offline', inner.parseLivePage('<link rel="canonical" href="https://www.youtube.com/@abc"> "isLiveNow":true') === undefined)

  // ============================================================ pacer
  {
    const out: number[] = []
    const p = new Pacer<number>((n) => out.push(n))
    p.push([1, 2, 3], 0)
    check('pacer span 0: all released at once, in order', out.join() === '1,2,3')
    const out2: { n: number; t: number }[] = []; const t0 = Date.now()
    const p2 = new Pacer<number>((n) => out2.push({ n, t: Date.now() - t0 }))
    p2.push([1, 2, 3, 4], 200)
    check('pacer: first immediately', out2.length === 1)
    await new Promise((r) => setTimeout(r, 400))
    check('pacer: ordered, all released, within the span', out2.map((x) => x.n).join() === '1,2,3,4' && out2[3].t >= 120 && out2[3].t < 300, out2)
    const out3: number[] = []; const p3 = new Pacer<number>((n) => out3.push(n))
    p3.push([1, 2, 3], 300); p3.stop()
    await new Promise((r) => setTimeout(r, 400))
    check('pacer stop() drops the rest', out3.join() === '1', out3)
  }

  // ============================================================ whole adapter against a fake YouTube
  const realST = globalThis.setTimeout
  // Shrink every delay 200x so 45 s polls take ~0.2 s. (Restored below.)
  ;(globalThis as any).setTimeout = (fn: any, ms?: number, ...a: any[]) => realST(fn, (ms ?? 0) / 200, ...a)

  const world = { liveAfterCalls: 2, liveCalls: 0, chatOpens: 0, polls: 0, failNextPoll: false, bannedPaths: [] as string[] }
  const pollScript: Record<string, object> = {
    TOKEN0: { continuationContents: { liveChatContinuation: { continuations: [{ timedContinuationData: { continuation: 'TOKEN1', timeoutMs: 1000 } }], actions: [
      add('liveChatTextMessageRenderer', base('h1', { message: { runs: [text('history')] } })), // already in history: must not repeat
      add('liveChatTextMessageRenderer', base('n1', { message: { runs: [text('first new')] } })),
      add('liveChatPaidMessageRenderer', base('n2', { purchaseAmountText: { simpleText: '$5.00' } }))] } } },
    TOKEN1: { continuationContents: { liveChatContinuation: { continuations: [{ timedContinuationData: { continuation: 'TOKEN2', timeoutMs: 1000 } }], actions: [
      { removeChatItemAction: { targetItemId: 'n1' } }, add('liveChatTextMessageRenderer', base('n3', { message: { runs: [text('after delete')] } }))] } } },
    TOKEN2: { continuationContents: {} } // chat ended
  }
  const fakeFetch = async (url: any, init?: any) => {
    const u = String(url)
    const ok = (body: string) => new Response(body, { status: 200 })
    if (u.includes('/@streamer/live')) { world.liveCalls++; return ok(livePage(VID, world.liveCalls > world.liveAfterCalls)) }
    if (u.includes('/@ghost/live')) return new Response('nope', { status: 404 })
    if (u.includes('/live_chat?')) { world.chatOpens++; return ok(chatHtml(liveData)) }
    if (u.includes('get_live_chat')) {
      world.polls++
      if (world.failNextPoll) { world.failNextPoll = false; return new Response('boom', { status: 503 }) }
      const token = JSON.parse(init.body).continuation as string
      if (!init.headers['Content-Type'] || !u.includes('key=KEY123')) return new Response('bad', { status: 400 })
      return new Response(JSON.stringify(pollScript[token] ?? {}), { status: 200 })
    }
    return new Response('?', { status: 404 })
  }
  ;(globalThis as any).fetch = fakeFetch

  const { YouTubeAdapter } = await import('../../src/main/adapters/youtube/index')
  const events: string[] = []
  const msgs: any[] = [], mods: any[] = [], statuses: any[] = []
  const adapter = new YouTubeAdapter({
    message: (m: any) => { msgs.push(m); events.push('msg:' + m.id) },
    moderation: (a: any) => { mods.push(a); events.push('mod:' + a.messageId) },
    status: (s: any) => statuses.push(s)
  }, ['@streamer'])
  world.failNextPoll = false
  await adapter.connect()
  await new Promise((r) => realST(r, 60))
  check('offline handle: connected + "waiting" tooltip', statuses.some((s) => s.state === 'connected' && /waiting for @streamer to go live/.test(s.detail)), statuses)
  await new Promise((r) => realST(r, 700))
  check('goes live: title shown in status', statuses.some((s) => s.state === 'connected' && s.detail.includes('Tom & Jerry LIVE')), statuses)
  check('history shown once; new messages in order; deletion after its message', events.join() === 'msg:h1,msg:n1,msg:n2,mod:n1,msg:n3', events)
  check('super chat survives end-to-end', msgs.find((m) => m.id === 'n2')?.meta?.superChat?.label === '$5.00')
  check('chat end -> back to waiting (not an error)', statuses[statuses.length - 1].state === 'connected' && /ended/.test(statuses[statuses.length - 1].detail), statuses[statuses.length - 1])

  // reconnect de-dup: the stream "comes back" (same history is re-sent) and one poll fails transiently
  world.failNextPoll = true; pollScript.TOKEN2 = { continuationContents: { liveChatContinuation: { continuations: [{ timedContinuationData: { continuation: 'TOKEN9', timeoutMs: 1000 } }], actions: [add('liveChatTextMessageRenderer', base('n4', { message: { runs: [text('later')] } }))] } } }
  const before = msgs.length
  await new Promise((r) => realST(r, 1200))
  check('transient 503 recovered by itself; history NOT repeated; new message arrives', msgs.slice(before).map((m: any) => m.id).join() === 'n4' && statuses.some((s) => s.state === 'connecting' && /retrying/.test(s.detail)), { added: msgs.slice(before).map((m: any) => m.id), statuses: statuses.map((s) => s.state + ':' + s.detail) })

  // adding/removing sources live
  adapter.setChannels(['@ghost'])
  await new Promise((r) => realST(r, 200))
  check('removed source stops; 404 handle shows a readable error', statuses[statuses.length - 1].state === 'error' && /@ghost was not found/.test(statuses[statuses.length - 1].detail), statuses[statuses.length - 1])
  const countBefore = msgs.length
  adapter.setChannels([])
  await new Promise((r) => realST(r, 100))
  check('no sources -> hint, no crash', /add a stream link/.test(statuses[statuses.length - 1].detail))
  adapter.disconnect()
  check('disconnect reports disconnected', statuses[statuses.length - 1].state === 'disconnected')
  const pollsAtStop = world.polls
  await new Promise((r) => realST(r, 300))
  check('nothing polls or emits after disconnect', world.polls === pollsAtStop && msgs.length === countBefore, { polls: world.polls - pollsAtStop })

  ;(globalThis as any).setTimeout = realST
})
