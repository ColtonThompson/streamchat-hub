/**
 * renderer/src/lib/color.ts
 *
 * WHAT: Keeps a username's colour READABLE on the current theme's background.
 *
 * WHY: Twitch lets every viewer pick any name colour, usually chosen for dark backgrounds. A pale
 * yellow vanishes on the Daylight theme and a deep blue is hard to read on dark ones. `readableOn`
 * leaves a colour alone if it is already readable; otherwise it nudges the LIGHTNESS only (keeping the
 * hue, so it still looks like "their" colour) until it reaches a comfortable contrast.
 *
 * THE MATH: "contrast ratio" is the standard web-accessibility measure (WCAG): 1 means identical,
 * 21 means black on white. 4.5 is the usual minimum for normal-sized text.
 *
 * HOW IT FITS: MessageRow calls `readableOn(msg.author.color, themeBg)` for every name.
 */

type RGB = [number, number, number]

/** "#abc" or "#aabbcc" -> [r, g, b] (0-255), or null if it isn't a hex colour. */
export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('') // "abc" -> "aabbcc"
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** How bright a colour looks to the eye, 0 (black) to 1 (white). Formula from the WCAG standard. */
function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Contrast between two colours: 1 (none) to 21 (maximum). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Dark or white text, whichever reads better on `bg` (a "#rrggbb" colour). Used for the Super Chat
 * amount pill, whose background colour comes from YouTube and can be anything from pale yellow to deep red.
 */
export function textOn(bg: string | undefined): string {
  const dark: RGB = [0x14, 0x11, 0x1b]
  const rgb = bg ? parseHex(bg) : null
  if (!rgb) return '#14111b'
  return contrastRatio(rgb, dark) >= contrastRatio(rgb, [255, 255, 255]) ? '#14111b' : '#ffffff'
}

// RGB <-> HSL: changing only "lightness" keeps hue and saturation, which is what keeps the colour recognisable.

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l] // grey: no hue
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  h /= 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255]
}

/** Results are cached: the same few hundred (colour, background) pairs repeat constantly in a busy chat. */
const cache = new Map<string, string>()

/**
 * Returns `color` unchanged if it already contrasts enough with `bg`; otherwise a lighter (on dark
 * backgrounds) or darker (on light ones) version with the same hue. `undefined` in, `undefined` out
 * (viewers without a colour fall back to the CSS default), and a value that isn't a hex colour is
 * returned untouched.
 */
export function readableOn(color: string | undefined, bg: string, minRatio = 4.5): string | undefined {
  if (!color) return undefined
  const key = `${color}|${bg}|${minRatio}`
  const hit = cache.get(key)
  if (hit) return hit

  const c = parseHex(color)
  const b = parseHex(bg)
  let result = color
  if (c && b && contrastRatio(c, b) < minRatio) {
    const [h, s, l0] = rgbToHsl(c)
    const lighten = luminance(b) < 0.5 // dark background -> go lighter; light background -> go darker
    let l = l0
    for (let i = 0; i < 40; i++) {
      l = Math.min(1, Math.max(0, l + (lighten ? 0.025 : -0.025)))
      const candidate = hslToRgb(h, s, l)
      result = toHex(candidate)
      if (contrastRatio(candidate, b) >= minRatio || l === 0 || l === 1) break
    }
  }
  if (cache.size > 5000) cache.clear() // safety valve so the cache can't grow without limit
  cache.set(key, result)
  return result
}
