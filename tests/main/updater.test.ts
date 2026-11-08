/**
 * tests/main/updater.test.ts
 *
 * The update state machine (checking -> available -> downloading -> ready), schedule, errors,
 * and that nothing happens when running from source. Uses a fake electron-updater.
 */
import { EventEmitter } from 'node:events'
import { scenario } from '../helpers/scenario'

await scenario('Auto-update service', async (check) => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const { UpdateService } = await import('../../src/main/updater')

  class FakeUpdater extends EventEmitter {
    autoDownload = false; autoInstallOnAppQuit = false
    checks = 0; installs: unknown[][] = []; failNext: Error | undefined
    async checkForUpdates() { this.checks++; if (this.failNext) { const e = this.failNext; this.failNext = undefined; throw e } return {} }
    quitAndInstall(...a: unknown[]) { this.installs.push(a) }
  }
  const make = (over: object = {}) => {
    const u = new FakeUpdater(); const states: any[] = []
    const svc = new UpdateService({ updater: u, version: '0.1.0', enabled: true, onState: (s: any) => states.push(s), now: () => 1000, ...over })
    return { u, svc, states }
  }

  // disabled (dev)
  { const { u, svc, states } = make({ enabled: false })
    svc.start(); await svc.check(); svc.install()
    check('disabled: state, no checks, no listeners, never installs', svc.getState().status === 'disabled' && u.checks === 0 && u.listenerCount('error') === 0 && u.installs.length === 0 && states.length === 0 && u.autoDownload === false) }

  // config + happy path
  { const { u, svc, states } = make()
    check('configures auto download + install on quit', u.autoDownload === true && u.autoInstallOnAppQuit === true && svc.getState().status === 'idle')
    const p = svc.check(); u.emit('checking-for-update'); await p
    u.emit('update-available', { version: '0.2.0' })
    u.emit('download-progress', { percent: 41.6 })
    u.emit('download-progress', { percent: 100.4 })
    check('flow: checking -> available -> downloading (rounded, clamped)', states.map((s) => s.status).join() === 'checking,available,downloading,downloading' && states[2].percent === 42 && states[3].percent === 100 && states[2].next === '0.2.0', states)
    svc.install()
    check('install ignored before ready', u.installs.length === 0)
    u.emit('update-downloaded', { version: '0.2.0' })
    check('ready', svc.getState().status === 'ready' && (svc.getState() as any).next === '0.2.0')
    svc.install()
    check('install: silent + run after', JSON.stringify(u.installs) === '[[true,true]]', u.installs)
    const n = u.checks; await svc.check()
    u.emit('error', new Error('late')); u.emit('checking-for-update')
    check('ready sticks: no re-check, errors/checking ignored', u.checks === n && svc.getState().status === 'ready') }

  // up to date
  { const { u, svc } = make(); await svc.check(); u.emit('update-not-available')
    check('none records checkedAt', svc.getState().status === 'none' && (svc.getState() as any).checkedAt === 1000) }

  // errors
  { const { u, svc, states } = make()
    u.failNext = new Error('net::ERR_INTERNET_DISCONNECTED\n    at foo (bar.js:1)'); await svc.check()
    check('check() rejection -> error, first line only', svc.getState().status === 'error' && (svc.getState() as any).message === 'net::ERR_INTERNET_DISCONNECTED', states)
    await svc.check()
    check('can retry after an error', u.checks === 2)
    u.emit('error', new Error('x'.repeat(400)))
    check('long error truncated', (svc.getState() as any).message.length === 160)
    u.emit('error', 'plain string')
    check('non-Error value handled', (svc.getState() as any).message === 'plain string') }

  // no overlapping checks
  { const { u, svc } = make(); u.emit('checking-for-update'); await svc.check()
    check('no second check while checking', u.checks === 0)
    u.emit('update-available', { version: '9.9.9' }); u.emit('download-progress', { percent: 5 }); await svc.check()
    check('no check while downloading', u.checks === 0) }

  // stray progress without an update-available is ignored
  { const { u, states } = make(); u.emit('download-progress', { percent: 5 })
    check('progress with no known version ignored', states.length === 0) }

  // schedule
  { const { u, svc } = make({ firstCheckMs: 20, intervalMs: 60 })
    svc.start(); await wait(10)
    check('nothing before first delay', u.checks === 0)
    await wait(30); const first = u.checks
    await wait(100)
    check('first check then periodic', first === 1 && u.checks >= 2, { first, now: u.checks })
    svc.dispose(); const n = u.checks; await wait(120)
    check('dispose stops the schedule', u.checks === n)
    u.emit('update-available', { version: '1' })
    check('dispose: no more state events', svc.getState().status !== 'available') }
})
