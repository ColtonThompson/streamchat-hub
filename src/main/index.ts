/**
 * main/index.ts   (the app's entry point)
 *
 * WHAT: Starts the app: creates the window, then connects the UI to the rest of the main process.
 *
 * THE THREE PARTS OF AN ELECTRON APP (worth knowing before editing anything):
 *   - MAIN process  (src/main)      Node.js. Can use the network, files, the OS. Runs adapters.
 *   - PRELOAD       (src/preload)   A tiny script that builds the safe `window.api` bridge.
 *   - RENDERER      (src/renderer)  The UI (React). Runs like a web page; has NO Node access.
 *   They are separate programs that talk through "IPC" messages. Channel names are in shared/types.ts.
 *
 * WHAT HAPPENS HERE:
 *   1. createWindow() builds the window and loads the UI.
 *   2. It creates the TwitchAuth (sign-in) and the MessageBus (chat pipeline).
 *   3. It registers `ipcMain.handle(...)` handlers: each one answers a request from the UI
 *      (e.g. "send this chat message") by calling into the bus or auth.
 *
 * SECURITY NOTE: Anything arriving over IPC comes from the UI and must be treated as untrusted
 *   input. The bus validates it (see MessageBus.moderate / send) before acting.
 *
 * CHANGE IT WHEN: you add a new UI -> main request (add a handler below) or change window behaviour.
 */
import { app, BrowserWindow, ipcMain, Notification, session, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { parseSources } from '../shared/channels'
import { zoomActionForKey } from '../shared/zoom'
import { isAppUrl, isTrustedSender, safeExternalUrl } from './security'
import { IPC, PLATFORMS, type LiveChannel, type LoginOptions, type ModerationCommand, type Platform, type StreamInfoTarget, type WindowTheme } from '../shared/types'
import { MessageBus } from './bus'
import { APP_ID } from './appId'
import { fetchStreamStats } from './adapters/youtube/innertube'
import { LiveWatcher } from './livewatch'
import { makeInfoFetcher, StreamInfoWatcher } from './streaminfo'
import { TwitchAuth } from './twitch/auth'
import { Helix } from './twitch/helix'
import { UpdateService } from './updater'
import { autoUpdater } from 'electron-updater'

/** Show a desktop notification. Returns false when the OS can't show any. Clicking opens `url` in the browser. */
function showNotification(title: string, body: string, url?: string): boolean {
  if (!Notification.isSupported()) {
    console.warn('[alerts] desktop notifications are not supported on this system')
    return false
  }
  const n = new Notification({ title, body })
  n.on('click', () => {
    const safe = safeExternalUrl(url)
    if (safe) void shell.openExternal(safe) // links never open inside the app window; only http(s) ones open at all
  })
  n.on('failed', (_e, error) => console.warn('[alerts] Windows refused the notification:', error))
  n.show()
  console.log(`[alerts] showed: ${title} - ${body}`)
  return true
}

/** The active bus. Kept at module level so handlers registered once can reach it. */
let bus: MessageBus | undefined

function createWindow(): void {
  const win = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 320,
    minHeight: 400,
    backgroundColor: '#15121d', // matches --bg in styles.css so there is no white flash on launch
    titleBarStyle: 'hidden', // we draw our own title; the native min/max/close buttons stay as an overlay
    titleBarOverlay: { color: '#15121d', symbolColor: '#e9e4f3', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, // UI code cannot reach the preload script's internals
      nodeIntegration: false, // UI code cannot use Node
      sandbox: true
    }
  })

  // Ctrl +, Ctrl - and Ctrl 0 change the CHAT text size (not the whole window). Electron's default menu
  // would otherwise grab these keys to zoom the entire page, so they are intercepted here first and
  // handed to the UI, which owns the setting.
  win.webContents.on('before-input-event', (event, input) => {
    const action = zoomActionForKey(input)
    if (!action) return
    event.preventDefault()
    win.webContents.send(IPC.zoomKey, action)
  })

  // Links clicked in chat open in the user's real browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const safe = safeExternalUrl(url) // http(s) only: a chat link must never start another program (checklist item 15)
    if (safe) void shell.openExternal(safe)
    return { action: 'deny' }
  })

  // The window may only ever show the app's own page (checklist item 13). A normal click on a chat link is a new-window
  // request (handled above); anything that tries to navigate the window itself, or redirects it, is blocked.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const block = (event: { preventDefault: () => void }, url: string): void => {
    if (!isAppUrl(url, devUrl)) event.preventDefault()
  }
  win.webContents.on('will-navigate', (event, url) => block(event, url))
  win.webContents.on('will-redirect', (event, url) => block(event, url))
  win.webContents.on('will-attach-webview', (event) => event.preventDefault()) // the app never uses <webview>

  // Requests from the UI are accepted only from the app's own page (checklist item 17).
  const handle = <A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => R): void => {
    ipcMain.handle(channel, (e, ...args) => {
      if (!isTrustedSender(e.senderFrame, devUrl)) {
        console.warn(`[security] ignored ${channel} from an untrusted frame`)
        return undefined
      }
      return fn(e, ...(args as A))
    })
  }
  const knownPlatform = (p: unknown): p is Platform => typeof p === 'string' && (PLATFORMS as string[]).includes(p)

  // --- sign-in and the chat pipeline -------------------------------------------------------
  const twitchAuth = new TwitchAuth()
  // Whenever sign-in state changes (pending code, signed in...), push it to the UI.
  const offAuth = twitchAuth.onChange((state) => !win.isDestroyed() && win.webContents.send(IPC.authState, state))
  void twitchAuth.init() // restore a saved login, if any (runs in the background)
  bus = new MessageBus(win, twitchAuth)

  // --- go-live notifications for followed channels (needs the "go-live alerts" permission) ---
  // Runs while signed in with the permission granted. Notifications additionally need the Settings
  // checkbox on; until the UI reports it (a moment after launch) they stay off, so nothing pops up by surprise.
  let liveAlertsWanted = false
  const followHelix = new Helix(twitchAuth)
  // The same check also feeds the suggestions in the Twitch box, so it runs whenever the permission is
  // granted; the Settings checkbox only decides whether notifications are shown.
  let liveList: LiveChannel[] = []
  let liveListKey = '[]'
  const liveWatch = new LiveWatcher({
    fetchLive: async () => (twitchAuth.userId ? followHelix.getFollowedStreams(twitchAuth.userId) : undefined),
    selfId: () => twitchAuth.userId,
    alertsOn: () => liveAlertsWanted,
    announce: (a) => showNotification(a.title, a.body, a.url),
    onList: (live) => {
      liveList = live
        .map((s) => ({ login: s.login, name: s.name, game: s.game, title: s.title, viewers: s.viewers }))
        .sort((a, b) => b.viewers - a.viewers)
      const key = JSON.stringify(liveList)
      if (key === liveListKey) return // unchanged: don't wake the UI every minute
      liveListKey = key
      if (!win.isDestroyed()) win.webContents.send(IPC.liveChanged, liveList)
    }
  })
  const syncLiveWatch = (): void => {
    const should = twitchAuth.canReadFollows && !!twitchAuth.userId
    if (should && !liveWatch.active) liveWatch.start()
    if (!should && liveWatch.active) liveWatch.stop()
  }
  const offLiveAuth = twitchAuth.onChange(syncLiveWatch)

  // --- title and viewer count of the single stream being read (only while the UI asks for it) ---
  const streamInfo = new StreamInfoWatcher({
    fetch: makeInfoFetcher({ twitchStream: (login) => followHelix.getStream(login), youtubeStats: fetchStreamStats }),
    onInfo: (info) => !win.isDestroyed() && win.webContents.send(IPC.streamInfoChanged, info)
  })

  // --- app updates (only active in an installed build; in `npm run dev` it is switched off) ---
  const updates = new UpdateService({
    updater: autoUpdater,
    version: app.getVersion(),
    enabled: app.isPackaged,
    onState: (state) => !win.isDestroyed() && win.webContents.send(IPC.updatesState, state)
  })
  updates.start()

  // --- requests from the UI ----------------------------------------------------------------
  // Each handler's name matches an entry in `IPC` (shared/types.ts) and a method in preload/index.ts.

  // Turn a platform on/off. Channel names are cleaned again here because IPC input is untrusted.
  handle(IPC.toggle, (_e, platform: Platform, enabled: boolean, channels: string[]) =>
    knownPlatform(platform) ? bus?.setEnabled(platform, enabled === true, parseSources(platform, (Array.isArray(channels) ? channels : []).join(' '))) : undefined
  )
  // Change which channels are being read while connected.
  handle(IPC.channels, (_e, platform: Platform, channels: string[]) =>
    knownPlatform(platform) ? bus?.setChannels(platform, parseSources(platform, (Array.isArray(channels) ? channels : []).join(' '))) : undefined
  )
  handle(IPC.send, (_e, platform: Platform, channel: string, text: string) =>
    knownPlatform(platform) && typeof channel === 'string' && typeof text === 'string' ? bus?.send(platform, channel, text) : { ok: false, error: 'Invalid request.' }
  )
  handle(IPC.moderate, (_e, command: ModerationCommand) => bus?.moderate(command))
  handle(IPC.emotesList, (_e, platform: Platform, channel: string) =>
    knownPlatform(platform) && typeof channel === 'string' && /^[A-Za-z0-9_]{1,25}$/.test(channel) ? (bus?.listEmotes(platform, channel) ?? []) : []
  )

  handle(IPC.authGet, () => twitchAuth.getState())
  handle(IPC.authLogin, (_e, options?: LoginOptions) => {
    // Login runs until the user approves in the browser (minutes). Don't make the UI wait on it:
    // progress arrives through the IPC.authState push above. The options come from the UI, so only
    // real `true` values count.
    void twitchAuth.login({
      moderation: options?.moderation === true,
      polls: options?.polls === true,
      follows: options?.follows === true,
      redemptions: options?.redemptions === true,
      emotes: options?.emotes === true
    })
  })
  handle(IPC.authCancel, () => twitchAuth.cancelLogin())
  handle(IPC.authLogout, () => twitchAuth.logout())

  handle(IPC.updatesGet, () => updates.getState())
  handle(IPC.updatesCheck, () => updates.check())
  handle(IPC.updatesInstall, () => updates.install())

  handle(IPC.streamInfoWatch, (_e, target: StreamInfoTarget | null) => {
    // From the UI, so check it: one platform we know, and a source that is plain channel text.
    const ok = !!target && (target.platform === 'twitch' || target.platform === 'youtube') && typeof target.source === 'string' && /^[@A-Za-z0-9_.-]{1,40}$/.test(target.source)
    streamInfo.watch(ok ? { platform: target.platform, source: target.source } : null)
  })
  handle(IPC.liveGet, () => liveList)
  handle(IPC.alertsTest, () => showNotification('StreamChat Hub', 'Go-live alerts will look like this.'))
  handle(IPC.liveAlerts, (_e, value: boolean) => {
    liveAlertsWanted = value === true
    syncLiveWatch()
  })

  handle(IPC.onTop, (_e, value: boolean) => win.setAlwaysOnTop(value === true, 'floating'))

  // Keep the native window frame in step with the chosen theme (otherwise the minimise/close strip
  // would stay dark on a light theme). The values come from the UI, so only plain #rrggbb is accepted.
  handle(IPC.windowTheme, (_e, theme: WindowTheme) => {
    const hex = /^#[0-9a-fA-F]{6}$/
    if (!hex.test(theme?.background ?? '') || !hex.test(theme?.foreground ?? '')) return
    win.setBackgroundColor(theme.background)
    try {
      // Not every platform has a title-bar overlay (macOS draws its own buttons); ignore if unsupported.
      win.setTitleBarOverlay({ color: theme.background, symbolColor: theme.foreground, height: 40 })
    } catch {
      /* unsupported on this platform: nothing to update */
    }
  })

  // --- cleanup -------------------------------------------------------------------------------
  win.on('closed', () => {
    offAuth()
    updates.dispose()
    offLiveAuth()
    liveWatch.stop()
    streamInfo.stop()
    bus?.dispose()
    bus = undefined
    // Handlers are registered per window, so remove them (a re-opened window registers them again).
    const channels = [
      IPC.toggle,
      IPC.channels,
      IPC.send,
      IPC.moderate,
      IPC.emotesList,
      IPC.authGet,
      IPC.authLogin,
      IPC.authCancel,
      IPC.authLogout,
      IPC.updatesGet,
      IPC.updatesCheck,
      IPC.updatesInstall,
      IPC.liveAlerts,
      IPC.alertsTest,
      IPC.liveGet,
      IPC.streamInfoWatch,
      IPC.onTop,
      IPC.windowTheme
    ]
    for (const ch of channels) ipcMain.removeHandler(ch)
  })

  // In development electron-vite serves the UI from a local dev server (hot reload); in a
  // production build it is a plain file.
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Windows needs an identity for notifications to show. Installed builds use the installer's id; in
// development there is no installer, so use a stable id of its own.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : `${APP_ID}.dev`)

app.whenReady().then(() => {
  // The UI needs exactly one browser permission: desktop notifications (mention alerts). Everything else (camera,
  // microphone, location, ...) is refused, as Electron's security checklist item 5 advises.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(permission === 'notifications' && isAppUrl(wc.getURL(), devUrl)))
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'notifications' && !!wc && isAppUrl(wc.getURL(), devUrl))
  createWindow()
  // macOS: clicking the dock icon with no windows open should re-open one.
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

// Quit when the last window closes (macOS apps traditionally keep running; we follow that convention).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
