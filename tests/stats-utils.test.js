import { describe, it, expect } from 'vitest'
import {
  formatDuration,
  formatDurationShort,
  formatRelative,
  aggregateByGame,
  computeStreaks
} from '../src/renderer/src/stats-utils'

const DAY = 24 * 3600 * 1000

describe('stats-utils', () => {
  it('formate les durées', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(30)).toBe('< 1 min')
    expect(formatDuration(45 * 60)).toBe('45 min')
    expect(formatDuration(3600)).toBe('1 h')
    expect(formatDuration(3600 + 5 * 60)).toBe('1 h 05')
    expect(formatDurationShort(90 * 60)).toBe('1,5 h')
    expect(formatDurationShort(20)).toBe('1 min')
  })

  it('formate les dates relatives', () => {
    const now = new Date(2026, 10, 14, 15).getTime()
    expect(formatRelative(null, now)).toBe('jamais')
    expect(formatRelative(now - 3600 * 1000, now)).toBe("aujourd'hui")
    expect(formatRelative(now - DAY, now)).toBe('hier')
    expect(formatRelative(now - 3 * DAY, now)).toBe('il y a 3 jours')
    expect(formatRelative(now - 20 * DAY, now)).toBe('il y a 2 semaines')
  })

  it('agrège les sessions par jeu', () => {
    const sessions = [
      { gameId: 'a', start: 100, end: 200, duration: 100 },
      { gameId: 'a', start: 1000, end: 1500, duration: 500 },
      { gameId: 'b', start: 50, end: 60, duration: 10 }
    ]
    expect(aggregateByGame(sessions)).toEqual({
      a: {
        playtime: 600,
        sessionCount: 2,
        firstPlayed: 100,
        lastPlayed: 1500,
        longestSession: 500
      },
      b: { playtime: 10, sessionCount: 1, firstPlayed: 50, lastPlayed: 60, longestSession: 10 }
    })
  })

  it('calcule les séries de jours joués', () => {
    const now = new Date(2026, 10, 14, 12).getTime()
    const at = (daysAgo) => ({ start: now - daysAgo * DAY })
    expect(computeStreaks([at(1), at(2), at(3), at(6), at(7)], now)).toEqual({
      current: 3,
      best: 3
    })
    expect(computeStreaks([at(5), at(6)], now)).toEqual({ current: 0, best: 2 })
    expect(computeStreaks([], now)).toEqual({ current: 0, best: 0 })
  })
})
