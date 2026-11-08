/**
 * tests/renderer/blacklist.test.ts   (the "hide messages containing..." filter)
 */
import { describe, expect, it } from 'vitest'
import { compileBlacklist, messageText } from '../../src/renderer/src/lib/blacklist'
import { chatMessage } from '../helpers/factories'

describe('messageText', () => {
  it('joins text, links and emote names, lower-cased with single spaces', () => {
    const m = chatMessage({
      parts: [
        { type: 'text', value: 'Hello   ' },
        { type: 'emote', value: 'Kappa', url: 'u', overlays: [{ value: 'z!', url: 'v' }] },
        { type: 'link', value: 'HTTPS://X.io', url: 'https://x.io' }
      ]
    })
    expect(messageText(m)).toBe('hello kappa z!https://x.io')
  })
})

describe('compileBlacklist', () => {
  it('hides nothing when the list is empty or only blanks', () => {
    expect(compileBlacklist([])(chatMessage({ text: 'anything' }))).toBe(false)
    expect(compileBlacklist(['', '   '])(chatMessage({ text: 'anything' }))).toBe(false)
  })

  it('matches anywhere in the text, ignoring case', () => {
    const hide = compileBlacklist(['Free Followers'])
    expect(hide(chatMessage({ text: 'get FREE followers now' }))).toBe(true)
    expect(hide(chatMessage({ text: 'free  followers' }))).toBe(true) // extra spaces do not matter
    expect(hide(chatMessage({ text: 'followers for free' }))).toBe(false)
  })

  it('matches any of several terms', () => {
    const hide = compileBlacklist(['spam', 'scam'])
    expect(hide(chatMessage({ text: 'a scam!' }))).toBe(true)
    expect(hide(chatMessage({ text: 'fine' }))).toBe(false)
  })

  it('can match an emote name', () => {
    const m = chatMessage({ parts: [{ type: 'emote', value: 'TriHard', url: 'u' }] })
    expect(compileBlacklist(['trihard'])(m)).toBe(true)
  })

  it('never hides events or moderation notes', () => {
    const ev = chatMessage({ text: 'spam', event: { type: 'sub', title: 'spam' } })
    expect(compileBlacklist(['spam'])(ev)).toBe(false)
  })
})
