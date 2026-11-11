/**
 * tests/renderer/suggest.test.ts
 *
 * Which live channel to suggest for what is typed, in what order, and what the text becomes after picking one.
 */
import { scenario } from '../helpers/scenario'

await scenario('Channel suggestions (Twitch box)', async (check) => {
  const { tokenAt, suggest, applySuggestion, buildChecklist, toggleChannel } = await import('../../src/renderer/src/lib/suggest')
  const L = (login: string, viewers: number, extra: object = {}) => ({ login, name: login[0].toUpperCase() + login.slice(1), game: 'Hades II', title: 't', viewers, ...extra })
  const live = [L('pixelwitch', 500), L('pixie', 1500), L('apexpro', 90000), L('witchhunt', 40), L('bob', 10), L('ネコ', 5, { name: 'ネコ' })]

  // tokenAt
  check('tokenAt: middle of a word', JSON.stringify(tokenAt('foo, bar baz', 6)) === '{"start":5,"end":8,"text":"bar"}', tokenAt('foo, bar baz', 6))
  check('tokenAt: at end of text', tokenAt('foo, ba', 7).text === 'ba' && tokenAt('foo, ba', 7).start === 5)
  check('tokenAt: between entries is empty', tokenAt('foo, bar', 4).text === '' && tokenAt('foo, bar', 5).text === 'bar' && tokenAt('', 0).text === '')
  check('tokenAt: caret out of range clamps', tokenAt('abc', 99).text === 'abc' && tokenAt('abc', -5).text === 'abc')

  // suggest
  check('empty token lists everyone, most viewers first', suggest(live, '', 0).map((c: any) => c.login).join() === 'apexpro,pixie,pixelwitch,witchhunt,bob,ネコ')
  check('prefix matches first (by viewers), then contains', suggest(live, 'pix', 3).map((c: any) => c.login).join() === 'pixie,pixelwitch', suggest(live, 'pix', 3).map((c: any) => c.login))
  check('"witch": prefix first, then substring', suggest(live, 'witch', 5).map((c: any) => c.login).join() === 'witchhunt,pixelwitch', suggest(live, 'witch', 5).map((c: any) => c.login))
  check('case-insensitive and ignores #', suggest(live, '#PIX', 4).length === 2)
  check('matches display name too', suggest(live, 'ネ', 1).map((c: any) => c.login).join() === 'ネコ')
  check('exact login gives no suggestion', suggest(live, 'bob', 3).length === 0)
  check('channels already listed are not offered', suggest(live, 'pixie, pix', 10).map((c: any) => c.login).join() === 'pixelwitch', suggest(live, 'pixie, pix', 10).map((c: any) => c.login))
  check('only the entry at the cursor is used', suggest(live, 'bob, pix', 2).length === 0 && suggest(live, 'bob, pix', 8).length === 2 && suggest(live, 'pix, zzz', 2).length === 2)
  check('no matches -> empty', suggest(live, 'zzzz', 4).length === 0)
  check('limit respected', suggest(live, '', 0, 2).length === 2)
  check('tokens listed via twitch.tv/ url count as taken', suggest(live, 'twitch.tv/bob, ', 15).every((c: any) => c.login !== 'bob'))

  // applySuggestion
  { const r = applySuggestion('pix', 3, 'pixie'); check('at end: replaces and appends ", "', r.draft === 'pixie, ' && r.caret === 7, r) }
  { const r = applySuggestion('foo, pi', 7, 'pixie'); check('second entry at end', r.draft === 'foo, pixie, ' && r.caret === 12, r) }
  { const r = applySuggestion('pi, foo', 2, 'pixie'); check('middle: replaces only the entry, no suffix', r.draft === 'pixie, foo' && r.caret === 5, r) }
  { const r = applySuggestion('foo, ', 5, 'bob'); check('empty entry at end inserts', r.draft === 'foo, bob, ' && r.caret === 10, r) }
  { const r = applySuggestion('', 0, 'bob'); check('empty box', r.draft === 'bob, ' && r.caret === 5, r) }

  // ---------------------------------------------------------------- the checklist
  const logins = (rows: any[]) => rows.map((r) => `${r.checked ? '+' : '-'}${r.login}`).join()
  check('settled: channels in the box come first, ticked, then the other live channels by viewers',
    logins(buildChecklist(live, 'bob, zed', 8, false)) === '+bob,+zed,-apexpro,-pixie,-pixelwitch,-witchhunt,-ネコ', logins(buildChecklist(live, 'bob, zed', 8, false)))
  { const r = buildChecklist(live, 'bob, zed', 8, false); check('a channel in the box that is live shows its info; one that is not is marked not live',
    r[0].live === true && r[0].viewers === 10 && r[0].game === 'Hades II' && r[1].live === false && r[1].viewers === 0, r.slice(0, 2)) }
  check('a typed full name counts as ticked once settled (clicking into the box)', logins(buildChecklist(live, 'pixie', 5, false)).startsWith('+pixie,-apexpro'), logins(buildChecklist(live, 'pixie', 5, false)))
  check('typing: the half-typed name filters and is not counted as ticked',
    logins(buildChecklist(live, 'bob, pix', 8, true)) === '-pixie,-pixelwitch', logins(buildChecklist(live, 'bob, pix', 8, true)))
  check('typing: ticked channels that match the filter stay in the list', logins(buildChecklist(live, 'pixie, pix', 10, true)) === '+pixie,-pixelwitch', logins(buildChecklist(live, 'pixie, pix', 10, true)))
  check('empty box + nothing live -> no rows', buildChecklist([], '', 0, false).length === 0)
  check('without live data the box contents are still listed (so they can be unticked)', logins(buildChecklist([], 'a, b', 4, false)) === '+a,+b')

  { const r = toggleChannel('', 0, 'bob', false); check('settled, add to an empty box', r.draft === 'bob, ' && r.caret === 5, r) }
  { const r = toggleChannel('foo', 3, 'bob', false); check('settled, add appends after the existing ones', r.draft === 'foo, bob, ' && r.caret === 10, r) }
  { const r = toggleChannel('foo, bob, ', 10, 'bob', false); check('clicking a ticked channel removes it', r.draft === 'foo, ' && r.caret === 5, r) }
  { const r = toggleChannel('bob', 3, 'bob', false); check('removing the last channel leaves an empty box', r.draft === '' && r.caret === 0, r) }
  { const r = toggleChannel('foo, pi', 7, 'pixie', true); check('typing: adding replaces the half-typed name', r.draft === 'foo, pixie, ' && r.caret === 12, r) }
  { const r = toggleChannel('foo, bob, pi', 12, 'bob', true); check('typing: unticking keeps what is being typed', r.draft === 'foo, pi, ', r) }
  { const r = toggleChannel('Foo, BOB', 8, 'bob', false); check('matching ignores case and tidies the rest', r.draft === 'foo, ', r) }
  { let t = { draft: '', caret: 0 }; for (const l of ['a', 'b', 'c']) t = toggleChannel(t.draft, t.caret, l, false)
    check('several clicks in a row build the list', t.draft === 'a, b, c, ', t)
    t = toggleChannel(t.draft, t.caret, 'b', false)
    check('...and unticking the middle one keeps the others in order', t.draft === 'a, c, ', t) }
})
