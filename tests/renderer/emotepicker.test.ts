/** tests/renderer/emotepicker.test.ts: picker search and inserting an emote into the message box. */
import { describe, expect, it } from 'vitest'
import { filterGroups, insertEmote } from '../../src/renderer/src/lib/emotepicker'

const groups = [
  { id: 'a', title: 'A', emotes: [{ name: 'Kappa', url: 'u' }, { name: 'KappaPride', url: 'u' }] },
  { id: 'b', title: 'B', emotes: [{ name: 'catJAM', url: 'u' }] }
]

describe('filterGroups', () => {
  it('matches anywhere in the name, ignoring case, and drops empty sections', () => {
    expect(filterGroups(groups, 'pride').map((g) => g.id)).toEqual(['a'])
    expect(filterGroups(groups, 'PRIDE')[0].emotes.map((e) => e.name)).toEqual(['KappaPride'])
    expect(filterGroups(groups, 'zzz')).toEqual([])
  })
  it('returns everything for an empty search', () => {
    expect(filterGroups(groups, '  ')).toBe(groups)
  })
})

describe('insertEmote', () => {
  it('adds spaces only where needed', () => {
    expect(insertEmote('', 0, 0, 'Kappa')).toEqual({ text: 'Kappa ', cursor: 6 })
    expect(insertEmote('hello', 5, 5, 'Kappa')).toEqual({ text: 'hello Kappa ', cursor: 12 })
    expect(insertEmote('hello ', 6, 6, 'Kappa')).toEqual({ text: 'hello Kappa ', cursor: 12 })
  })
  it('inserts in the middle and replaces a selection', () => {
    expect(insertEmote('ab cd', 3, 3, 'X')).toEqual({ text: 'ab X cd', cursor: 5 })
    expect(insertEmote('hi there', 3, 8, 'Kappa')).toEqual({ text: 'hi Kappa ', cursor: 9 })
  })
  it('refuses when it would not fit', () => {
    expect(insertEmote('a'.repeat(498), 498, 498, 'Kappa')).toBeUndefined()
  })
})
