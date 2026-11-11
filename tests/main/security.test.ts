/** tests/main/security.test.ts: the window lock-down rules (Electron security checklist items 13, 15, 17). */
import { describe, expect, it } from 'vitest'
import { isAppUrl, isTrustedSender, isTwitchLoginUrl, safeExternalUrl } from '../../src/main/security'

describe('safeExternalUrl', () => {
  it('allows http(s) only', () => {
    expect(safeExternalUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com/')
    for (const bad of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'ms-msdt:/id', 'vscode://x', 'data:text/html,hi', '//evil.com', 'not a url', '', 5, null, undefined]) {
      expect(safeExternalUrl(bad)).toBeUndefined()
    }
    expect(safeExternalUrl('https://example.com/' + 'a'.repeat(5000))).toBeUndefined()
  })
})

describe('isAppUrl / isTrustedSender', () => {
  const dev = 'http://localhost:5173/'
  it('packaged: only the bundled page', () => {
    expect(isAppUrl('file:///C:/Users/me/AppData/Local/Programs/app/resources/app.asar/out/renderer/index.html')).toBe(true)
    expect(isAppUrl('file:///C:/other/evil.html')).toBe(false)
    expect(isAppUrl('https://example.com/renderer/index.html')).toBe(false)
    expect(isAppUrl('about:blank')).toBe(false)
  })
  it('development: only the dev server origin', () => {
    expect(isAppUrl('http://localhost:5173/index.html', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppUrl('https://localhost:5173/', dev)).toBe(false)
  })
  it('IPC: the top-level app frame only', () => {
    const page = 'file:///x/out/renderer/index.html'
    expect(isTrustedSender({ url: page })).toBe(true)
    expect(isTrustedSender({ url: page, parent: {} })).toBe(false) // a sub-frame
    expect(isTrustedSender({ url: 'https://evil.com' })).toBe(false)
    expect(isTrustedSender(null)).toBe(false)
  })
})

describe('isTwitchLoginUrl', () => {
  it('requires https on twitch.tv', () => {
    expect(isTwitchLoginUrl('https://www.twitch.tv/activate?device-code=ABC')).toBe(true)
    expect(isTwitchLoginUrl('https://twitch.tv/activate')).toBe(true)
    expect(isTwitchLoginUrl('http://www.twitch.tv/activate')).toBe(false)
    expect(isTwitchLoginUrl('https://twitch.tv.evil.com/activate')).toBe(false)
    expect(isTwitchLoginUrl('https://eviltwitch.tv/')).toBe(false)
    expect(isTwitchLoginUrl(undefined)).toBe(false)
  })
})
