/**
 * tests/main/pins-redemptions.test.ts
 *
 * Twitch pinned messages (reading the API reply, the poller that reports changes), Channel Points reward
 * redemptions (EventSub events -> feed rows), and YouTube's pinned-message banner.
 */
import { scenario } from '../helpers/scenario'

await scenario('Pinned messages and reward redemptions', async (check) => {
  const { parseTwitchPin, PinWatcher } = await import('../../src/main/twitch/pins')
  const { HelixError } = await import('../../src/main/twitch/helix')
  const { parseRedemptionEvent, REDEMPTION_EVENTS } = await import('../../src/main/twitch/activity')
  const { parseActions } = await import('../../src/main/adapters/youtube/parse')

  // ================================================================== Twitch pin reply
  const raw = (extra: object = {}) => ({
    message_id: 'm-1', broadcaster_id: '42', sender_user_id: '7', sender_user_login: 'pixelwitch', sender_user_name: 'PixelWitch',
    pinned_by_user_id: '9', pinned_by_user_login: 'modmax', pinned_by_user_name: 'ModMax',
    message: { text: 'Rules: be kind Kappa', fragments: [{ type: 'text', text: 'Rules: be kind ' }, { type: 'emote', text: 'Kappa', emote: { id: '25' } }] },
    starts_at: '2026-11-10T20:00:00Z', ends_at: null, updated_at: '2026-11-10T20:00:00Z', ...extra
  })
  const p = parseTwitchPin('PixelWitch', raw())!
  check('pin: ids, names, channel lowercased', p.platform === 'twitch' && p.channelId === 'pixelwitch' && p.messageId === 'm-1' && p.author.name === 'PixelWitch' && p.pinnedBy === 'ModMax', p)
  check('pin: text + emote parts', p.parts.length === 2 && p.parts[0].type === 'text' && p.parts[1].type === 'emote' && (p.parts[1] as { url: string }).url.includes('/emoticons/v2/25/'), p.parts)
  check('pin: no end time when pinned until stream end', p.endsAt === undefined)
  check('pin: end time kept', parseTwitchPin('c', raw({ ends_at: '2026-11-10T20:30:00Z' }))!.endsAt === Date.parse('2026-11-10T20:30:00Z'))
  check('pin: falls back to plain text without fragments', parseTwitchPin('c', raw({ message: { text: 'hello' } }))!.parts[0].type === 'text')
  check('pin: unusable data -> undefined', parseTwitchPin('c', null) === undefined && parseTwitchPin('c', {}) === undefined && parseTwitchPin('c', raw({ message_id: '' })) === undefined && parseTwitchPin('c', raw({ message: { text: '', fragments: [] } })) === undefined)

  // ================================================================== PinWatcher
  {
    type Pin = NonNullable<ReturnType<typeof parseTwitchPin>>
    const events: string[] = []
    let answer: Pin | null | undefined | Error = null
    const asked: string[] = []
    let clock = 0
    let channels = [{ login: 'a', id: '1' }, { login: 'b', id: '2' }]
    const w = new PinWatcher({
      targets: () => channels,
      fetchPin: async (t) => {
        asked.push(t.login)
        if (t.login === 'b') throw new HelixError(403, 'not a moderator')
        if (answer instanceof Error) throw answer
        return answer
      },
      onPin: (x) => events.push(`pin:${x.channelId}:${x.messageId}`),
      onUnpin: (l) => events.push(`unpin:${l}`),
      intervalMs: 1_000_000,
      now: () => clock
    })
    const pinA = (id: string, over: object = {}): Pin => ({ ...parseTwitchPin('a', raw({ message_id: id }))!, ...over })
    answer = pinA('m1')
    await w.poll()
    check('first poll reports the existing pin', events.join() === 'pin:a:m1', events)
    await w.poll()
    check('unchanged pin is not reported again', events.join() === 'pin:a:m1')
    answer = pinA('m2')
    await w.poll()
    check('a different pin replaces it', events.join() === 'pin:a:m1,pin:a:m2')
    answer = pinA('m2', { endsAt: 5 })
    await w.poll()
    check('a changed expiry counts as a change', events.at(-1) === 'pin:a:m2' && events.length === 3)
    answer = undefined
    await w.poll()
    check('"could not tell" changes nothing', events.length === 3)
    answer = new Error('network')
    await w.poll()
    check('a network error changes nothing', events.length === 3)
    answer = null
    await w.poll()
    check('pin gone -> unpin', events.at(-1) === 'unpin:a' && events.length === 4)
    await w.poll()
    check('still nothing pinned: no repeat unpin', events.length === 4)
    check('403 channel is skipped for a while (asked once only)', asked.filter((x) => x === 'b').length === 1, asked)
    clock = 700_000
    await w.poll()
    check('...and asked again after the pause', asked.filter((x) => x === 'b').length === 2)
    answer = pinA('m3')
    await w.poll()
    channels = [{ login: 'b', id: '2' }]
    await w.poll()
    check('removing a channel takes its pin down', events.at(-1) === 'unpin:a', events)
    w.start()
    check('start() makes it active; stop() clears pins and stops', w.active === true)
    w.stop()
    check('stopped', w.active === false)
  }

  // ================================================================== redemptions
  const rbase = { broadcaster_user_id: '42', broadcaster_user_login: 'PixelWitch', broadcaster_user_name: 'PixelWitch', user_id: '7', user_login: 'viewer1', user_name: 'Viewer1', redeemed_at: '2026-11-10T20:00:00Z' }
  const custom = parseRedemptionEvent('channel.channel_points_custom_reward_redemption.add', { ...rbase, id: 'r1', user_input: 'hello!', status: 'unfulfilled', reward: { id: 'x', title: 'Hydrate', cost: 1500, prompt: 'drink' } })!
  check('custom redemption row', custom.id === 'redemption-r1' && custom.event?.type === 'redemption' && custom.event.title === 'Viewer1 redeemed “Hydrate” · 1,500 pts' && custom.channelId === 'pixelwitch' && custom.platform === 'twitch' && custom.timestamp === Date.parse('2026-11-10T20:00:00Z'), custom)
  check('custom redemption carries the viewer\'s message', custom.parts.length === 1 && custom.parts[0].type === 'text' && (custom.parts[0] as { value: string }).value === 'hello!' && custom.author.name === 'Viewer1')
  check('no input -> no message parts', parseRedemptionEvent('channel.channel_points_custom_reward_redemption.add', { ...rbase, id: 'r2', user_input: '', reward: { title: 'T', cost: 1 } })!.parts.length === 0)
  const auto = parseRedemptionEvent('channel.channel_points_automatic_reward_redemption.add', { ...rbase, id: 'r3', reward: { type: 'send_highlighted_message', channel_points: 300, emote: null }, message: { text: 'look at me', fragments: [] } })!
  check('automatic reward: friendly name, cost, message', auto.event?.title === 'Viewer1 redeemed “Highlight My Message” · 300 pts' && (auto.parts[0] as { value: string }).value === 'look at me', auto)
  check('unknown automatic reward type is made readable', parseRedemptionEvent('channel.channel_points_automatic_reward_redemption.add', { ...rbase, id: 'r4', reward: { type: 'brand_new_thing', channel_points: 1 } })!.event?.title.includes('brand new thing') === true)
  check('other types / bad payloads -> undefined', parseRedemptionEvent('channel.poll.begin', { ...rbase, id: 'x' }) === undefined && parseRedemptionEvent('channel.channel_points_custom_reward_redemption.add', {}) === undefined && parseRedemptionEvent('channel.channel_points_custom_reward_redemption.add', null) === undefined)
  check('both event names are subscribed', REDEMPTION_EVENTS.length === 2 && REDEMPTION_EVENTS.every((e) => e.startsWith('channel.channel_points_')))

  // ================================================================== partly refused subscriptions are reported
  {
    const { EventSubClient } = await import('../../src/main/twitch/eventsub')
    const handlers: Record<string, (d: unknown) => void> = {}
    const socket = { on: (e: string, cb: (d: unknown) => void) => void (handlers[e] = cb), close: () => {}, removeAllListeners: () => {} }
    let reported: { type: string; ok: boolean; error?: string }[] = []
    const client = new EventSubClient({
      types: ['channel.poll.begin', 'channel.channel_points_custom_reward_redemption.add'],
      createSocket: () => socket as never,
      subscribe: async (type) => (type.includes('redemption') ? { ok: false, error: 'missing scope' } : { ok: true }),
      onNotification: () => {},
      onState: () => {},
      onSubscribed: (r) => (reported = r)
    })
    client.start()
    handlers.message({ toString: () => JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'S', keepalive_timeout_seconds: 10 } } }) })
    await new Promise((r) => setTimeout(r, 20))
    client.stop()
    check('per-type results are reported (one accepted, one refused)', reported.length === 2 && reported[0].ok && !reported[1].ok && reported[1].type.includes('redemption') && reported[1].error === 'missing scope', reported)
  }

  // ================================================================== YouTube pinned banner
  const ctx = (extra: object = {}) => ({ videoId: 'dQw4w9WgXcQ', ...extra })
  const banner = (inner: object | undefined, header = 'Pinned by PixelWitch') => ({
    addBannerToLiveChatCommand: {
      bannerRenderer: { liveChatBannerRenderer: {
        header: { liveChatBannerHeaderRenderer: { text: { runs: [{ text: header }] } } },
        contents: inner ? { liveChatTextMessageRenderer: inner } : { somethingElse: {} },
        actionId: 'act1'
      } }
    }
  })
  const line = { id: 'yt-pin-1', authorName: { simpleText: 'PixelWitch' }, authorExternalChannelId: 'UCwitch', timestampUsec: '1790000000123456', message: { runs: [{ text: 'Be kind to each other' }] } }
  const out = parseActions([banner(line)], ctx({ channelLabel: '@pixelwitch' }))
  const pin = out[0]
  check('banner -> pin item', out.length === 1 && pin.kind === 'pin' && pin.pin.platform === 'youtube' && pin.pin.channelId === 'dQw4w9WgXcQ' && pin.pin.messageId === 'yt-pin-1' && pin.pin.author.name === 'PixelWitch' && pin.pin.pinnedBy === 'PixelWitch' && pin.pin.channelLabel === '@pixelwitch', out)
  check('banner pin keeps the text', pin.kind === 'pin' && pin.pin.parts.length === 1 && (pin.pin.parts[0] as { value: string }).value === 'Be kind to each other')
  check('a banner that is not a pinned chat line is ignored', parseActions([banner(undefined)], ctx()).length === 0)
  const rm = parseActions([{ removeBannerForLiveChatCommand: { targetActionId: 'act1' } }], ctx())
  check('removing the banner -> unpin', rm.length === 1 && rm[0].kind === 'unpin' && rm[0].channelId === 'dQw4w9WgXcQ' && rm[0].platform === 'youtube')
  const warned: string[] = []
  parseActions([banner(line), { removeBannerForLiveChatCommand: {} }], ctx({ onUnknown: (k: string) => warned.push(k) }))
  check('banner actions are no longer logged as unknown', warned.length === 0, warned)
})
