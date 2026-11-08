/**
 * tests/stubs/electron.ts
 *
 * A stand-in for the `electron` package, used by every test (vitest.config.ts points the name
 * "electron" here). The real package only works inside the Electron program; code that imports it
 * (sign-in, the message bus) would crash under plain Node. Add members here when a new test needs them.
 *
 * `testControl` lets a test choose whether tokens can be encrypted to disk and start with an empty
 * private "user data" folder, so sign-in persistence can be tested without touching real files.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = mkdtempSync(join(tmpdir(), 'streamchat-hub-test-'))
let encryption = false

export const testControl = {
  /** Switch to a brand-new empty user-data folder (returns its path). */
  newUserDataDir(): string {
    userData = mkdtempSync(join(tmpdir(), 'streamchat-hub-test-'))
    return userData
  },
  /** Pretend the operating system can (or cannot) encrypt saved tokens. */
  setEncryption(on: boolean): void {
    encryption = on
  }
}

export const app = { getPath: () => userData, getVersion: () => '0.0.0-test', isPackaged: false }

/** "Encryption" here is just a prefix: enough to prove tokens go through it, and to detect a corrupt file. */
export const safeStorage = {
  isEncryptionAvailable: () => encryption,
  encryptString: (s: string) => Buffer.from('enc:' + s),
  decryptString: (b: Buffer) => {
    const text = b.toString()
    if (!text.startsWith('enc:')) throw new Error('cannot decrypt')
    return text.slice(4)
  }
}

export const shell = { openExternal: (_url: string) => {} }
