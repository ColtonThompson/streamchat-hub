/**
 * tests/main/auth.test.ts
 *
 * Twitch sign-in against a fake Twitch: the device-code flow, cancelling, token refresh, and saving and
 * restoring the session. (That sign-in never silently drops an earlier permission is tested in
 * twitch-activity.test.ts.)
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TwitchAuth } from '../../src/main/twitch/auth'
import type { AuthState } from '../../src/shared/types'
import { app, testControl } from '../stubs/electron'
import { sleep } from '../helpers/timers'

interface Call {
  endpoint: string
  form: Record<string, string>
  auth?: string
}
type Handler = (form: Record<string, string>) => Response | Promise<Response>

const realFetch = globalThis.fetch
let calls: Call[] = []
let handlers: Partial<Record<'device' | 'token' | 'validate' | 'revoke', Handler>> = {}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const pending = () => json({ status: 400, message: 'authorization_pending' }, 400)
const defaults = (): typeof handlers => ({
  device: () => json({ device_code: 'dev1', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate', expires_in: 60, interval: 0 }),
  token: () => json({ access_token: 'tok1', refresh_token: 'ref1', expires_in: 3600 }),
  validate: () => json({ user_id: '42', login: 'pixelwitch', expires_in: 3600, scopes: ['user:write:chat'] }),
  revoke: () => json({})
})

beforeEach(() => {
  calls = []
  handlers = defaults()
  testControl.newUserDataDir()
  testControl.setEncryption(false)
  globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
    const endpoint = String(url).split('/').pop() as keyof typeof handlers
    const form = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {}
    calls.push({ endpoint, form, auth: (init.headers as Record<string, string> | undefined)?.Authorization })
    const handler = handlers[endpoint]
    if (!handler) throw new Error(`unexpected request to ${url}`)
    return handler(form)
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

/** A new TwitchAuth that records every state it publishes. */
function make() {
  const auth = new TwitchAuth()
  const states: AuthState[] = []
  auth.onChange((s) => states.push(s))
  return { auth, states }
}
const signedIn = async (encryption = false) => {
  testControl.setEncryption(encryption)
  const m = make()
  await m.auth.login()
  return m
}
const file = () => join(app.getPath(), 'twitch-auth.bin')
const exists = (p: string) => fs.access(p).then(() => true, () => false)

describe('signing in', () => {
  it('is configured when a client id exists, and starts signed out', () => {
    const { auth } = make()
    expect(auth.getState()).toEqual({ status: 'signed-out', configured: true })
  })

  it('shows the code to type, then signs in with the account Twitch reports', async () => {
    const { auth, states } = make()
    await auth.login()
    expect(states[0]).toMatchObject({ status: 'pending', userCode: 'ABCD-EFGH', verificationUri: 'https://www.twitch.tv/activate' })
    expect(auth.getState()).toMatchObject({ status: 'signed-in', login: 'pixelwitch', userId: '42', canModerate: false, canReadPolls: false, canReadFollows: false })
    expect(await auth.getAccessToken()).toBe('tok1')
  })

  it('keeps polling until the user approves', async () => {
    let n = 0
    handlers.token = () => (++n < 3 ? pending() : json({ access_token: 'tok1', refresh_token: 'ref1', expires_in: 3600 }))
    const { auth } = make()
    await auth.login()
    expect(n).toBe(3)
    expect(auth.getState().status).toBe('signed-in')
  })

  it('sends the device code and our client id when polling', async () => {
    const { auth } = make()
    await auth.login()
    const poll = calls.find((c) => c.endpoint === 'token')!
    expect(poll.form).toMatchObject({ client_id: 'testclient', device_code: 'dev1', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
  })

  it('reports why Twitch refused to start the sign-in', async () => {
    handlers.device = () => json({ message: 'invalid client' }, 400)
    const { auth } = make()
    await auth.login()
    expect(auth.getState()).toMatchObject({ status: 'signed-out', error: 'invalid client' })
  })

  it('reports an expired code', async () => {
    handlers.device = () => json({ device_code: 'd', user_code: 'U', verification_uri: 'https://www.twitch.tv/activate', expires_in: 0, interval: 0 })
    const { auth } = make()
    await auth.login()
    expect(auth.getState()).toMatchObject({ status: 'signed-out', error: 'The code expired. Try again.' })
  })

  it('refuses to open a sign-in address that is not on twitch.tv', async () => {
    handlers.device = () => json({ device_code: 'd', user_code: 'U', verification_uri: 'https://evil.example/activate', expires_in: 60, interval: 0 })
    const { auth } = make()
    await auth.login()
    expect(auth.getState()).toMatchObject({ status: 'signed-out' })
    expect(auth.getState().error).toContain('unexpected sign-in address')
  })

  it('reports a refusal (the user clicked "deny")', async () => {
    handlers.token = () => json({ message: 'access_denied' }, 400)
    const { auth } = make()
    await auth.login()
    expect(auth.getState()).toMatchObject({ status: 'signed-out', error: 'access_denied' })
  })

  it('fails clearly if the new token cannot be verified', async () => {
    handlers.validate = () => json({}, 401)
    const { auth } = make()
    await auth.login()
    expect(auth.getState().error).toContain('could not be verified')
  })

  it('cancelling stops the wait and leaves you signed out', async () => {
    handlers.token = () => pending()
    const { auth } = make()
    const flow = auth.login()
    await sleep(15)
    expect(auth.getState().status).toBe('pending')
    auth.cancelLogin()
    await flow
    expect(auth.getState().status).toBe('signed-out')
    expect(calls.filter((c) => c.endpoint === 'token').length).toBeLessThan(50)
  })

  it('cancelling an upgrade does NOT sign you out', async () => {
    const { auth } = await signedIn()
    handlers.token = () => pending()
    const upgrade = auth.login({ moderation: true })
    await sleep(15)
    auth.cancelLogin()
    await upgrade
    expect(auth.getState()).toMatchObject({ status: 'signed-in', login: 'pixelwitch' })
  })

  it('lets a newer sign-in take over from an older one that is still waiting', async () => {
    let devices = 0
    handlers.device = () => json({ device_code: `dev${++devices}`, user_code: 'U', verification_uri: 'https://www.twitch.tv/activate', expires_in: 60, interval: 0 })
    handlers.token = (form) => (form.device_code === 'dev2' ? json({ access_token: 'tok2', refresh_token: 'r', expires_in: 3600 }) : pending())
    const { auth, states } = make()
    const first = auth.login()
    await sleep(15)
    const second = auth.login()
    await Promise.all([first, second])
    expect(auth.getState().status).toBe('signed-in')
    expect(await auth.getAccessToken()).toBe('tok2')
    expect(states.some((s) => s.error)).toBe(false) // the abandoned attempt ended quietly
  })
})

describe('signing out', () => {
  it('forgets the session, revokes the token and deletes the saved file', async () => {
    const { auth } = await signedIn(true)
    expect(await exists(file())).toBe(true)
    await auth.logout()
    expect(auth.getState().status).toBe('signed-out')
    expect(await auth.getAccessToken()).toBeUndefined()
    expect(await exists(file())).toBe(false)
    await sleep(10)
    expect(calls.find((c) => c.endpoint === 'revoke')?.form).toEqual({ client_id: 'testclient', token: 'tok1' })
  })
})

describe('token refresh', () => {
  const expiringSoon = () => {
    handlers.validate = () => json({ user_id: '42', login: 'pixelwitch', expires_in: 30, scopes: ['user:write:chat'] }) // under the 60 s safety margin
  }

  it('renews a token that is about to expire, and keeps the rotated refresh token', async () => {
    expiringSoon()
    let n = 0
    handlers.token = (form) => (form.grant_type === 'refresh_token' ? json({ access_token: `new${++n}`, refresh_token: `rot${n}`, expires_in: 3600 }) : json({ access_token: 'tok1', refresh_token: 'ref1', expires_in: 3600 }))
    const { auth } = await signedIn()
    expect(await auth.getAccessToken()).toBe('new1')
    expect(calls.filter((c) => c.form.grant_type === 'refresh_token')[0].form.refresh_token).toBe('ref1')
    expect(await auth.refresh()).toBe(true)
    expect(calls.filter((c) => c.form.grant_type === 'refresh_token')[1].form.refresh_token).toBe('rot1')
  })

  it('shares one request between callers that refresh at the same time', async () => {
    const { auth } = await signedIn()
    handlers.token = async () => {
      await sleep(10)
      return json({ access_token: 'fresh', expires_in: 3600 })
    }
    const results = await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()])
    expect(results).toEqual([true, true, true])
    expect(calls.filter((c) => c.form.grant_type === 'refresh_token')).toHaveLength(1)
  })

  it('keeps the old refresh token when Twitch does not send a new one', async () => {
    const { auth } = await signedIn()
    handlers.token = () => json({ access_token: 'fresh', expires_in: 3600 })
    await auth.refresh()
    await auth.refresh()
    expect(calls.filter((c) => c.form.grant_type === 'refresh_token').map((c) => c.form.refresh_token)).toEqual(['ref1', 'ref1'])
  })

  it('signs you out with a message when Twitch rejects the refresh token', async () => {
    const { auth } = await signedIn()
    handlers.token = () => json({ message: 'Invalid refresh token' }, 400)
    expect(await auth.refresh()).toBe(false)
    expect(auth.getState()).toMatchObject({ status: 'signed-out', error: 'Your Twitch session ended. Sign in again.' })
    expect(await auth.getAccessToken()).toBeUndefined()
  })

  it('stays signed in through a Twitch outage (5xx) or rate limit (429)', async () => {
    const { auth } = await signedIn()
    for (const status of [503, 429]) {
      handlers.token = () => json({ message: 'try later' }, status)
      expect(await auth.refresh()).toBe(false)
      expect(auth.getState().status).toBe('signed-in')
    }
  })

  it('stays signed in through a network problem and tries again later', async () => {
    const { auth } = await signedIn()
    handlers.token = () => {
      throw new Error('offline')
    }
    expect(await auth.refresh()).toBe(false)
    expect(auth.getState().status).toBe('signed-in')
    handlers.token = () => json({ access_token: 'back', expires_in: 3600 })
    expect(await auth.refresh()).toBe(true)
  })
})

describe('saving and restoring the session', () => {
  it('saves nothing when the system cannot encrypt', async () => {
    await signedIn(false)
    expect(await exists(file())).toBe(false)
  })

  it('does not store tokens as readable text', async () => {
    await signedIn(true)
    expect((await fs.readFile(file())).toString().startsWith('enc:')).toBe(true) // went through safeStorage
  })

  it('restores a saved session at startup', async () => {
    await signedIn(true)
    const { auth, states } = make()
    await auth.init()
    expect(auth.getState()).toMatchObject({ status: 'signed-in', login: 'pixelwitch', userId: '42' })
    expect(states).toHaveLength(1)
  })

  it('uses the refresh token when the saved access token has expired', async () => {
    await signedIn(true)
    handlers.validate = (() => {
      let first = true
      return () => (first ? ((first = false), json({}, 401)) : json({ user_id: '42', login: 'pixelwitch', expires_in: 3600, scopes: [] }))
    })()
    handlers.token = () => json({ access_token: 'renewed', refresh_token: 'ref2', expires_in: 3600 })
    const { auth } = make()
    await auth.init()
    expect(auth.getState().status).toBe('signed-in')
    expect(await auth.getAccessToken()).toBe('renewed')
  })

  it('signs out when the saved session is dead', async () => {
    await signedIn(true)
    handlers.validate = () => json({}, 401)
    handlers.token = () => json({}, 400)
    const { auth } = make()
    await auth.init()
    expect(auth.getState()).toMatchObject({ status: 'signed-out', error: 'Your Twitch session ended. Sign in again.' })
    expect(await exists(file())).toBe(false)
  })

  it('does nothing when there is no saved session, or the file is corrupt', async () => {
    testControl.setEncryption(true)
    const a = make()
    await a.auth.init()
    expect(a.states).toHaveLength(0)

    await fs.writeFile(file(), 'garbage')
    const b = make()
    await b.auth.init()
    expect(b.auth.getState().status).toBe('signed-out')
  })

  it('never calls Twitch at startup when nothing was saved', async () => {
    testControl.setEncryption(true)
    await make().auth.init()
    expect(calls).toHaveLength(0)
  })
})
