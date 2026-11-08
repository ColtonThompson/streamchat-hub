# StreamChat Hub

One merged chat for every platform you stream to. Built with **Electron + React + TypeScript + Zustand**.

Today: full Twitch support (reading, emotes, badges, events, sending, moderation). Other platforms
run a fake "mock" feed until their real adapters are written.

---

## 1. Run it

```bash
npm install
npm run dev          # development, with live reload
npm run build        # production bundle
npm run typecheck    # checks all the TypeScript without building (run this after edits!)
```

Type your Twitch channel (several are fine, comma-separated) into **Twitch channels**, then switch
Twitch on. Reading chat needs no login.

### Twitch sign-in (badge images, sending messages, moderation)

1. Go to <https://dev.twitch.tv/console> and **Register Your Application**.
2. Set **OAuth Redirect URLs** to `http://localhost`, **Category** to *Application Integration*,
   **Client Type** to **Public**.
3. Copy the **Client ID**. Copy `.env.example` to `.env` and paste it in.
4. Restart `npm run dev`, click **Sign in to Twitch**, enter the code on the page that opens.

For the **mod toolbar** click **Enable moderation tools** after signing in. That re-authorizes with
extra permissions (delete messages, time out, ban). It only works in channels where you are the
broadcaster or a moderator.

---

## 2. How the app is organized

An Electron app is really **three programs** that talk by messages:

| Part | Folder | What it is | Can it use the network/files? |
|---|---|---|---|
| **Main process** | `src/main` | Node.js. Connects to platforms, calls APIs, holds tokens. | Yes |
| **Preload** | `src/preload` | A tiny script that exposes a safe `window.api` to the UI. | Limited |
| **Renderer (UI)** | `src/renderer` | The React interface. Behaves like a web page. | No (by design) |

`src/shared` holds code and types used by all three. **Start by reading `src/shared/types.ts`**: it
defines every important data shape.

```
src/
  shared/
    types.ts            The vocabulary: ChatMessage, events, moderation, HubApi, IPC names
    channels.ts         Cleans what you type in each platform's box: Twitch names ("twitch.tv/foo, #bar"
                        -> ["foo","bar"]) or YouTube sources ("@handle", stream links, video ids)
  main/
    index.ts            Entry point: creates the window, wires UI requests to the bus/auth
    bus.ts              THE HEART. Collects chat from adapters, adds emotes/badges, batches to the UI,
                        and handles send/moderate requests
    env.d.ts            Types for .env variables
    adapters/           One folder/file per platform
      base.ts             The contract every adapter follows
      index.ts            Registry: which adapter handles which platform
      mock.ts             Fake chat/events used for platforms with no real adapter yet
      twitch/
        index.ts            The Twitch connection (WebSocket, reconnects, command routing)
        irc.ts              Splits a raw Twitch chat line into tags/command/params/text
        parse.ts            Converts those pieces into ChatMessage / events / moderation
        gifts.ts            Stops a "gift 20 subs" from creating 21 rows
      youtube/
        index.ts            Lifecycle: one reader per @handle/stream, retries, de-duplication, status chip
        innertube.ts        Talks to YouTube: find the live stream, open its chat, poll it
        parse.ts            YouTube chat items -> ChatMessage (emotes, Super Chats, memberships, deletions)
        pacer.ts            Spreads each poll's burst of messages over time so chat flows smoothly
    emotes/             7TV, BetterTTV, FrankerFaceZ
      service.ts          Downloads emote lists, swaps matching words for emote images
      providers/          One file per service (+ index.ts = priority order)
    twitch/
      auth.ts             Sign-in (device-code flow), permission tiers, token storage and refresh
      helix.ts            Twitch web API client: badges, send chat, delete/timeout/ban/unban, EventSub subscribe
      badges.ts           Attaches badge images to messages
      eventsub.ts         Twitch's second connection (WebSocket) for things chat doesn't carry; reconnects itself
      (helix.ts also has getFollowedStreams, used by livewatch.ts)
      activity.ts         Poll/prediction events -> live card state + a few feed rows (pure, easy to test)
    livewatch.ts        Every minute asks Twitch which followed channels are live; desktop notification for new ones
    updater.ts          Checks GitHub Releases for a newer version, downloads it, installs on restart
  preload/index.ts      Builds window.api (the only door between UI and main)
  renderer/
    index.html          The page (and its security policy)
    src/
      main.tsx / App.tsx  UI entry and overall layout
      store/chatStore.ts  All UI state (Zustand): messages, platforms on/off, auth, toast...
      lib/                Small helpers: platform colours, event colours, moderation logic, @mentions
      components/         PlatformBar, ChannelInput, AccountRow, ChatFeed, MessageRow,
                          ModToolbar, Toast, Composer, ActivityPanel (poll/prediction cards),
                          UpdateBanner, settings/ (Appearance, Chat, Accounts, About tabs)
      styles.css          All styling (heavily commented; read its header)
```

---

## 3. How data flows

**A chat message arriving (platform -> screen):**

```
Twitch ──WebSocket──> adapters/twitch/index.ts
                         │ parseIrc (irc.ts)          raw line -> pieces
                         │ privmsgToChatMessage       pieces   -> ChatMessage        (parse.ts)
                         ▼
                      bus.ts  ── EmoteService.process   words   -> 7TV/BTTV/FFZ emotes
                         │   └─ BadgeService.process   badge ids -> badge images
                         │ queue, flushed every 50 ms
                         ▼ IPC "chat:batch"
                      preload  ──> window.api.onBatch
                         ▼
                      store.addItems ──> messages[] ──> ChatFeed ──> MessageRow
```

**You pressing a button (screen -> platform):**

```
ModToolbar "10m" ─> window.api.moderate(cmd) ─IPC─> main/index.ts ─> bus.moderate (validates)
                                                    ─> helix.ban ──HTTPS──> Twitch API
Twitch then announces the timeout on chat (CLEARCHAT) ─> parse.ts ─> ModerationEvent
   ─> store.addItems ─> applyModeration marks that user's messages as removed
```

**Polls and predictions come through a second Twitch connection (EventSub), not chat:**

```
Twitch EventSub ──WebSocket──> twitch/eventsub.ts   welcome -> subscribe to 7 event types (Helix) -> notifications
                                  │ parseActivityEvent (activity.ts)
                                  ▼
                       bus.ts  ─ a LIVE STATE ("activity" item: replaces the previous state of that poll)
                               └ a few feed ROWS (poll started/ended, prediction started/locked/resolved)
                                  ▼ IPC "chat:batch" (same path as chat)
                       store.activities ──> ActivityPanel (cards above the feed)
```
It runs only when ALL are true: you are signed in with the **polls & predictions** permission (Settings ->
Accounts), Twitch is on, and **your own channel** is in the Twitch box. Twitch only gives a channel's
poll/prediction events to its own broadcaster, so this cannot show polls in someone else's channel.
`MessageBus.syncActivity` (bus.ts) starts and stops the connection as those things change.

**YouTube works differently from Twitch:** there is no always-open connection. The adapter *polls*:

```
@yourhandle ─> findLiveVideo (youtube.com/@yourhandle/live) ─> the live video id
            ─> openChat (the chat page)  ─> a "continuation" bookmark + recent history
            ─> pollChat every 1-8 s      ─> new actions + a new bookmark   (loop; no bookmark = chat ended)
actions ─> parse.ts ─> ChatMessage ─> pacer (spreads them out) ─> emit.message ─> bus ─> UI (same as Twitch)
```

Note the second diagram: **the UI does not change when you press the button.** It changes when
Twitch confirms. That keeps one source of truth, and it means a refused action (not a mod) simply
shows an error toast and nothing else.

### Key ideas
- **Adapter**: code for ONE platform. Converts that platform's data to `ChatMessage`.
- **ChatMessage**: the single shape everything uses. A chat line, a sub card and a "user was banned"
  note are all ChatMessages (the special ones have `event` set).
- **IPC**: messages between the UI and main process. Channel names are in `IPC` (`shared/types.ts`).
- **ModerationEvent** = something that *happened* (from the platform). **ModerationCommand** =
  something *you ask for* (from the UI). Easy to confuse; they flow in opposite directions.

---

## 4. Recipes: common changes

### Change colours / look
Edit the variables at the top of `src/renderer/src/styles.css`. Platform colours are in
`renderer/src/lib/platforms.ts`, event colours in `renderer/src/lib/events.ts`.

### Change the timeout buttons
Edit `TIMEOUT_PRESETS` at the top of `components/ModToolbar.tsx` (`{ label: '5m', seconds: 300 }`).
Twitch allows 1 second to 2 weeks (1,209,600).

### Show a new Twitch event
1. Find its `msg-id` (log `line` in `adapters/twitch/index.ts` `handle()` while it happens).
2. Add `thatMsgId: 'sub'` (or another type) to `EVENT_TYPES` in `adapters/twitch/parse.ts`.
3. To give it a new look: add a type to `EventType` (`shared/types.ts`) and an entry in `lib/events.ts`.

### Add a button the UI can press that does something in the main process
1. `shared/types.ts`: add the method to `HubApi` and a name to `IPC`.
2. `preload/index.ts`: implement it (`ipcRenderer.invoke(IPC.yourName, ...)`).
3. `main/index.ts`: `ipcMain.handle(IPC.yourName, ...)` (and remove it in the `closed` handler).
4. Validate any input in the handler/bus: it comes from the UI, so treat it as untrusted.
TypeScript will point out any step you forget.

### Add a new platform (YouTube, Kick...)
1. Make `adapters/<platform>/index.ts` with a class that `implements ChatAdapter` (see `adapters/base.ts`).
2. Convert incoming messages to `ChatMessage` and call `emit.message(...)`. Report connection state
   with `emit.status(...)`.
3. Add a `case` for it in `adapters/index.ts`.
That's it: the UI, shading, filtering and top-bar chip already work for any platform.
If it has deletes/bans, also call `emit.moderation(...)`.

### Change how @mentions look or complete
Chips: `.mention` in `styles.css` (the `[data-me='true']` rule is the stronger look for mentions of you).
What counts as a mention, and how Tab completion picks and cycles names: `renderer/src/lib/mentions.ts`
(pure functions, so easy to test). `components/Composer.tsx` only wires the Tab key to it. Names are
suggested newest chatter first, from the channel you're sending to.

### Show a YouTube chat item that isn't shown yet
The terminal prints `[youtube] unhandled chat item "someRenderer" (ignored)` once per unknown kind.
Add a `case 'someRenderer':` in `parseItem` (`adapters/youtube/parse.ts`; copy `liveChatMembershipItemRenderer`).
To see the raw data, `console.log(JSON.stringify(r))` inside that case. Kinds that are on purpose
silent are listed in `IGNORED` in the same file.

### Add an emote service
Create `emotes/providers/<name>.ts` exporting an `EmoteProvider` (copy `bttv.ts`), then add it to the
list in `emotes/providers/index.ts`. Its position sets its priority.

### Add a setting
Add the field + initial value + (if it changes) an action to `store/chatStore.ts`; read it in a
component with `useChatStore((s) => s.yourField)`. See `showEvents` for a complete example
(store -> PlatformBar button -> ChatFeed filter).

### Ask Twitch for another permission
Add the scope to `BASIC_SCOPES`, `MODERATION_SCOPES` or `POLL_SCOPES` in `main/twitch/auth.ts` (or make a new
group: add a list, a `canXxx` getter, a field on `LoginOptions` in `shared/types.ts`, and a line in `login()`).
Users must sign in again to grant it; `login()` re-requests every group already granted, so adding one never
removes another. Then add the API call to `main/twitch/helix.ts` (copy `deleteMessage`).

### Show another kind of Twitch event (EventSub)
Polls and predictions are the template. Add the event name to `ACTIVITY_EVENTS` and a `case` in
`parseActivityEvent` (`main/twitch/activity.ts`); the event's required scope goes in `auth.ts` (see above).
Twitch lists every event's fields at dev.twitch.tv/docs/eventsub/eventsub-reference. For something that is
not a poll/prediction card, produce a `ChatMessage` with an `event` (like the other event rows).

---

## Releasing (installer + automatic updates)

**How it works.** `electron-builder` turns the app into a Windows installer (`electron-builder.yml`).
Each release is a GitHub Release holding that installer plus a small `latest.yml` file. The installed app
(`src/main/updater.ts`, using `electron-updater`) reads `latest.yml` ~10 s after launch and every 4 hours,
downloads a newer version quietly, shows a **Restart to update** bar, and otherwise installs it when the
user next quits. Settings -> About shows the version and has a **Check for updates** button. Updates are
off in `npm run dev` (nothing is packaged).

**Fill in once, before the first release**
1. `package.json`: set `repository.url` to your GitHub repo (the updater downloads from there) and `author`.
2. `electron-builder.yml`: change `appId` (e.g. `com.yourname.streamchathub`). Also change `APP_ID` in `src/main/appId.ts` to the same value (Windows notifications need them to match). Don't change it later:
   Windows treats a new id as a different app.
3. Replace `build/icon.png` (a 512x512 PLACEHOLDER I generated) with your own, at least 256x256.
4. Repo -> Settings -> Secrets and variables -> Actions -> **Variables**: add `MAIN_VITE_TWITCH_CLIENT_ID`
   (your Twitch client id, baked into the build; it is public, so a variable is fine).
5. The repo must be **public** for updates to work without a token. For a private repo you'd need a
   different host or a token inside the app, which isn't safe to ship.

**Try an installer locally (Windows):** `npm install`, then `npm run dist`. The installer appears in
`release/`. Quick unpacked check without an installer: `npm run dist:dir`.

**Publish a release**
1. Set `"version"` in `package.json` (e.g. `0.1.0-rc.1`, then `0.1.0`).
2. Commit, then `git tag v0.1.0-rc.1 && git push origin main v0.1.0-rc.1`.
3. The workflow in `.github/workflows/release.yml` builds on Windows and uploads to a GitHub Release
   (it fails if the tag and `package.json` version differ). Check the release's files include
   `StreamChat-Hub-Setup-<version>.exe`, its `.blockmap` and `latest.yml`.
4. Tags containing `-` (like `-rc.1`) become pre-releases on GitHub. A user running an RC is offered
   newer RCs and stable releases; a user on a stable version only gets stable ones.

**To test updating:** install version A, publish a higher version B, then open the installed A and press
Check for updates (or wait). Expect "Downloading...", then the banner. This path can't be tested from
`npm run dev`.

**Windows SmartScreen.** The installer is unsigned, so Windows shows "Windows protected your PC" on first
install (More info -> Run anyway). Updates still work. To remove the warning you need a code-signing
certificate (an EV/OV certificate, or Azure Trusted Signing); add it to `electron-builder.yml` under `win`
and the CI secrets. macOS/Linux builds aren't set up (macOS auto-update additionally requires signing).

---

### Suggestions in the Twitch box

With the go-live permission on, the Twitch channels box suggests followed channels that are live (game +
viewers): type to filter, Tab takes the top match, Up/Down + Enter picks, Esc closes, or click the
"N live" button for the whole list. Logic: `renderer/src/lib/suggest.ts`; the component:
`ChannelInput.tsx`; the list comes from the same once-a-minute check as the notifications (`main/livewatch.ts`).
Not yet checked visually in a real window, so tell me if the dropdown looks off.

### Go-live notifications

Settings -> Accounts -> **Enable go-live alerts** asks Twitch for the `user:read:follows` permission. After that
a checkbox, "Notify me when channels I follow go live", turns the alerts on or off (saved in settings). While on,
`main/livewatch.ts` calls Twitch's `/streams/followed` every minute and shows a Windows notification such as
"PixelWitch is live - Playing Hades II · title"; clicking it opens the channel in your browser.
It never announces streams that were already live when the app started, skips quick drop-and-return blips
(10 min), and shows one summary if more than 3 go live at once. Kick isn't covered: there is no Kick adapter yet.
Settings -> Accounts has a **Send test notification** button to check that Windows shows them, and the terminal (dev mode) logs `[livewatch]` / `[alerts]` lines for each check. Not tested against real Twitch from the build environment; if nothing appears, confirm the notification
permission for the app in Windows Settings -> System -> Notifications (and Focus assist / Do not disturb).

---

## 5. Debugging

- **Main process logs** (adapter, emotes, badges, API errors) appear in the **terminal** running
  `npm run dev`. Look for `[emotes]` and `[badges]` lines.
- **UI logs/errors** appear in the window's DevTools: View menu -> Toggle Developer Tools
  (or `Ctrl/Cmd+Shift+I`).
- **See raw Twitch data**: add `console.log(line)` at the top of `handle()` in
  `adapters/twitch/index.ts`.
- **A feature does nothing?** Check the terminal first, then DevTools. A `window.api.something is
  not a function` error means a step of "add a button" above was skipped.
- **An image won't load?** The page's Content-Security-Policy (`renderer/index.html`) must allow its
  source. Emotes and badges come from `https:` hosts, which are allowed.
- **No poll/prediction cards?** Check, in order: (1) Settings -> Accounts shows "Polls & predictions on"
  (otherwise click Enable and approve in the browser), (2) Twitch is on and YOUR channel name is in the
  Twitch box, (3) the feed shows "Watching your polls & predictions" (or a red-worded "unavailable" row saying
  why). The terminal has no extra logging; to see raw events, `console.log(type, event)` at the top of
  `parseActivityEvent`.
- **YouTube chat not loading?** Read the chip's tooltip and the red text under the YouTube box: it says
  "waiting for @you to go live", "chat is turned off for this stream", "connection problem, retrying", etc.
  If YouTube changed its page, you'll see "unexpected layout": fix `parseChatPage` in
  `adapters/youtube/innertube.ts`. If chat loads but rows are missing or odd, see `parse.ts`.
- **Run `npm run typecheck`** after every edit. It catches most mistakes in seconds.

---

## 6. Things to know

- **Tokens** are encrypted with the OS keychain (Electron `safeStorage`) and saved in the app's user-data
  folder. If the OS can't encrypt, they are NOT saved (you sign in each launch).
- **Messages are kept in memory only**, the latest 2,000 (`MAX_MESSAGES` in `chatStore.ts`).
- **Removed messages** are kept and shown as a placeholder (click to peek), not erased.
- **Twitch's API changes.** The endpoints used are noted in comments next to each call
  (`helix.ts`, `emotes/providers/*`). If something stops working, check the platform's docs first.
- Twitch doesn't say *which moderator* performed an action, so notes don't name one.
- **YouTube reading uses YouTube's unofficial chat endpoint ("InnerTube")**, the same one its own chat
  window uses. Upside: no Google sign-in, no API key, no daily quota (the official API's 10,000-unit quota
  would run out mid-stream). Downside: it isn't a documented API, so YouTube can change it without notice
  (all the fragile code is in `adapters/youtube/innertube.ts` and `parse.ts`), and it is outside YouTube's
  published API terms. Sending/moderating on YouTube would need the official API and a Google sign-in.
- **Polls & predictions are for your own channel only** (a Twitch rule, not ours), need the extra permission,
  and are not replayed: if the connection drops mid-poll, updates during the gap are lost and the card catches
  up on the next vote. Cards for finished polls stay two minutes; the x closes one (it stays closed).
- YouTube viewers have no chosen name colour, so each gets a stable colour made from their channel id.
- YouTube doesn't say whether a removal was a timeout or a ban, so the note says "timed out or banned".
- A YouTube message's `channelId` is the stream's video id; with several YouTube streams on at once the
  rows are not tagged by stream yet.

## 7. Not built yet (ideas)

- Real adapters for Kick, X, TikTok (the mock feed stands in for them)
- YouTube: sending messages and moderating (needs Google sign-in + the official API), a per-stream tag
  when several streams are open, and member/Super Chat event filters
- 7TV live emote updates (currently refreshed every 15 minutes)
- More settings (which events to show, whether to show removed messages by default); the panel itself exists
- Transparent always-on-top overlay window and an OBS browser-source view
- Per-channel "am I a moderator here?" detection (the toolbar currently shows for any channel once
  moderation tools are enabled; Twitch refuses the action where you aren't a mod and the reason is shown)
