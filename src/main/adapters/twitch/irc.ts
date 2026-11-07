/**
 * main/adapters/twitch/irc.ts
 *
 * WHAT: Reads one raw line of Twitch chat protocol and splits it into labelled pieces.
 *
 * BACKGROUND: Twitch chat speaks "IRC", a very old text protocol, over a WebSocket. Each line looks like:
 *
 *   @badges=moderator/1;color=#1E90FF;id=abc :nick!nick@nick.tmi.twitch.tv PRIVMSG #chan :hello there
 *   |_____ tags ______|  |________ prefix ______|  |command| |param|  |__ trailing text __|
 *
 *   - tags      key=value pairs of extra data (badges, colour, emote positions...). The part that
 *               makes Twitch chat rich. Only present because we request the "tags" capability.
 *   - prefix    who sent it.
 *   - command   what kind of line it is (PRIVMSG = chat message, USERNOTICE = sub/raid, ...).
 *   - params    arguments before the colon, usually the channel ("#chan").
 *   - trailing  everything after " :", usually the message text.
 *
 * HOW IT FITS: adapters/twitch/index.ts passes each incoming line through `parseIrc`, then looks at
 *   `.command` to decide what to do. parse.ts turns the pieces into app-level objects.
 *
 * CHANGE IT WHEN: rarely. This is generic protocol parsing and doesn't know about the app.
 */

export interface IrcMessage {
  /** The `key=value` tags, already un-escaped. A tag with no value maps to ''. */
  tags: Record<string, string>
  prefix?: string
  /** e.g. "PRIVMSG", "USERNOTICE", "CLEARCHAT", "PING", or a number like "001". */
  command: string
  params: string[]
  trailing?: string
}

/**
 * Tag values escape special characters (a space would otherwise end the tag section).
 * `\s` means a space, `\:` a semicolon, `\\` a backslash, and so on.
 */
const ESCAPES: Record<string, string> = { ':': ';', s: ' ', r: '\r', n: '\n', '\\': '\\' }
const unescapeTag = (v: string) => v.replace(/\\(.)/g, (_, c: string) => ESCAPES[c] ?? c)

/** Parse one line. Returns null for lines too malformed to use (they are simply ignored). */
export function parseIrc(line: string): IrcMessage | null {
  let rest = line
  const tags: Record<string, string> = {}

  // 1. Tags: "@a=1;b=2 " at the very start.
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ')
    if (sp < 0) return null
    for (const pair of rest.slice(1, sp).split(';')) {
      const eq = pair.indexOf('=')
      if (eq < 0) tags[pair] = ''
      else tags[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1))
    }
    rest = rest.slice(sp + 1)
  }

  // 2. Prefix: ":nick!nick@nick.tmi.twitch.tv " identifies the sender.
  let prefix: string | undefined
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ')
    if (sp < 0) return null
    prefix = rest.slice(1, sp)
    rest = rest.slice(sp + 1)
  }

  // 3. Trailing text: everything after the first " :" is one block (it may itself contain spaces/colons).
  let trailing: string | undefined
  const ti = rest.indexOf(' :')
  if (ti >= 0) {
    trailing = rest.slice(ti + 2)
    rest = rest.slice(0, ti)
  }

  // 4. What's left is "COMMAND param param ...".
  const [command, ...params] = rest.split(' ').filter(Boolean)
  if (!command) return null
  return { tags, prefix, command, params, trailing }
}
