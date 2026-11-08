/**
 * tests/renderer/mentions.test.ts
 *
 * Finding @names in messages, who can be completed, and how Tab cycles through matches.
 */
import { scenario } from '../helpers/scenario'

await scenario('@mentions: highlighting, chatter list, Tab completion', async (check) => {
  const { splitMentions, mentionAt, recentChatters, completeMention } = await import('../../src/renderer/src/lib/mentions')

  // ---- highlighting
  const show = (t: string) => splitMentions(t).map((p) => (p.kind === 'mention' ? `[${p.name}]` : p.value)).join('')
  check('plain text untouched', show('hello world') === 'hello world')
  check('mention mid-sentence', show('hey @PixelWitch thanks') === 'hey [PixelWitch] thanks')
  check('mention at start and end', show('@bob_1 hi @Alice') === '[bob_1] hi [Alice]')
  check('trailing punctuation not part of name', show('hi @Alice, ok? @Bobby.') === 'hi [Alice], ok? [Bobby].')
  check('possessive', show("@Alice's cat") === "[Alice]'s cat")
  check('email is not a mention', show('mail me@example.com') === 'mail me@example.com')
  check('double @ is not a mention', show('@@alice') === '@@alice')
  check('too short / lone @ ignored', show('@ab and @ and @') === '@ab and @ and @')
  check('overlong name (26) not matched', show('@' + 'a'.repeat(26)) === '@' + 'a'.repeat(26))
  check('25 chars matches', show('@' + 'a'.repeat(25)) === '[' + 'a'.repeat(25) + ']')
  check('pieces always rebuild the original text', ['hi @Alice, @Bob_2!', 'x@y @@z @abc', '', '@abcd'].every((t) => splitMentions(t).map((p) => p.value).join('') === t))
  check('unicode neighbours', show('こんにちは @Alice です') === 'こんにちは [Alice] です')

  // ---- chatters
  const msg = (name: string, extra: object = {}, channelId = 'chan', platform = 'twitch') => ({ id: Math.random() + '', platform, channelId, author: { name, badges: [] }, parts: [], timestamp: 0, ...extra }) as any
  const history = [msg('Zed'), msg('alice'), msg('Alicia'), msg('Bob'), msg('ALICE'), msg('ハチ'), msg('Other', {}, 'elsewhere'), msg('YT', {}, 'chan', 'youtube'), msg('Banned', { removed: 'ban' }), msg('Timed', { removed: 'timeout' }), msg('Deleted', { removed: 'deleted' }), msg('', { event: { type: 'raid', title: 'x' } }), msg('Eventer', { event: { type: 'sub', title: 'x' } })]
  const chatters = recentChatters(history, 'twitch', 'chan')
  check('newest first, deduped case-insensitively (newest spelling wins)', chatters.join() === 'Deleted,ALICE,Bob,Alicia,Zed', chatters)
  check('other channel / platform / banned / timed out / events / non-ASCII names excluded', !['Other', 'YT', 'Banned', 'Timed', 'Eventer', 'ハチ'].some((n) => chatters.includes(n)))
  check('limit respected', recentChatters(Array.from({ length: 50 }, (_, i) => msg('user' + i)), 'twitch', 'chan', 10).length === 10)

  // ---- mentionAt
  check('mentionAt finds @prefix before cursor', JSON.stringify(mentionAt('hi @al', 6)) === JSON.stringify({ start: 3, prefix: 'al' }))
  check('mentionAt: bare @', JSON.stringify(mentionAt('@', 1)) === JSON.stringify({ start: 0, prefix: '' }))
  check('mentionAt: not after a word / not mid-word', mentionAt('me@al', 5) === undefined && mentionAt('hi al', 5) === undefined)
  check('mentionAt: cursor in the middle uses only text before it', JSON.stringify(mentionAt('hi @alice ok', 6)) === JSON.stringify({ start: 3, prefix: 'al' }))
  check('mentionAt: finished word then space is not a mention context', mentionAt('hi @al ', 7) === undefined)

  // ---- completion
  const ch = ['Zed', 'alice', 'Alicia', 'Bob']
  let r = completeMention('hey @al', 7, ch)!
  check('first Tab: completes with newest match + trailing space, cursor after it', r.text === 'hey @alice ' && r.cursor === 11, r)
  r = completeMention(r.text, r.cursor, ch, r.session)!
  check('Tab again: next match replaces it', r.text === 'hey @Alicia ' && r.cursor === 12, r)
  r = completeMention(r.text, r.cursor, ch, r.session)!
  check('Tab again: wraps around to the first', r.text === 'hey @alice ', r)
  r = completeMention(r.text, r.cursor, ch, r.session, true)!
  check('Shift+Tab goes back (wraps to last)', r.text === 'hey @Alicia ', r)
  r = completeMention('@', 1, ch)!
  check('bare @ completes to the most recent chatter at the start of a message', r.text === '@Zed ' && r.cursor === 5, r)
  r = completeMention('hi @b', 5, ch, undefined, true)!
  check('Shift+Tab as first press starts from the last match', r.text === 'hi @Bob ', r)
  check('case-insensitive prefix', completeMention('@ZE', 3, ch)!.text === '@Zed ')
  const none = completeMention('hi @qq', 6, ch)!
  check('no match: handled, text unchanged, no session', none.text === 'hi @qq' && none.cursor === 6 && none.session === undefined, none)
  check('not in a mention: undefined (Tab should move focus)', completeMention('hello', 5, ch) === undefined && completeMention('hi @bob ', 8, ch) === undefined)
  // mid-text completion keeps what follows
  r = completeMention('hey @al thanks', 7, ch)!
  check('completing mid-text keeps the rest, no double space', r.text === 'hey @alice thanks' && r.cursor === 11, r)
  r = completeMention(r.text, r.cursor, ch, r.session)!
  check('...and cycling there works too', r.text === 'hey @Alicia thanks' && r.cursor === 12, r)
  // session invalidation
  const first = completeMention('hey @al', 7, ch)!
  const typed = completeMention(first.text + 'x', first.cursor + 1, ch, first.session)
  check('typing after a completion ends the cycle (no mention context -> Tab passes through)', typed === undefined, typed)
  const moved = completeMention(first.text, 3, ch, first.session)
  check('moving the cursor away ends the cycle', moved === undefined, moved)
  // max length
  check('refuses to exceed the message limit', completeMention('x'.repeat(495) + ' @al', 499, ch)!.text === 'x'.repeat(495) + ' @al')
  check('single match: Tab again re-inserts the same name (stable)', (() => { const a = completeMention('@bo', 3, ch)!; const b = completeMention(a.text, a.cursor, ch, a.session)!; return b.text === a.text })())

})
