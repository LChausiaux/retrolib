import { describe, it, expect } from 'vitest'
import { genreLabel, genreOptions } from '../src/renderer/src/genres'

describe('genres', () => {
  it('traduit les genres connus et garde les autres', () => {
    expect(genreLabel('Role-Playing')).toBe('RPG')
    expect(genreLabel('Racing')).toBe('Course')
    expect(genreLabel('Inconnu')).toBe('Inconnu')
  })

  it('compte les jeux par genre, triés par libellé', () => {
    const games = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const byGame = {
      a: { genres: ['Racing', 'Action'] },
      b: { genres: ['Racing'] }
    }
    expect(genreOptions(games, byGame)).toEqual([
      { value: 'Action', label: 'Action', count: 1 },
      { value: 'Racing', label: 'Course', count: 2 }
    ])
  })
})
