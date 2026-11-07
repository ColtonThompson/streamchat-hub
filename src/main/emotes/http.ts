/**
 * main/emotes/http.ts
 *
 * WHAT: Two tiny helpers shared by the emote providers.
 */

/**
 * GET a URL and decode the JSON.
 * - Returns `undefined` on 404. That is a NORMAL answer here: it means "this streamer has no account
 *   on that emote service", not an error.
 * - Throws on any other failure (network error, timeout after 8 s, 500...). The caller
 *   (EmoteService.fetchAll) catches it so one broken provider never breaks the others.
 */
export async function getJson<T>(url: string): Promise<T | undefined> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } })
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as T
}

/** Some APIs return protocol-relative URLs ("//cdn.example.com/x.png"). Make them absolute. */
export const absoluteUrl = (u: string) => (u.startsWith('//') ? 'https:' + u : u)
