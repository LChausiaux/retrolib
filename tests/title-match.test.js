import { describe, it, expect } from 'vitest'
import {
  normalizeTokens,
  prepareTitle,
  titleSimilarity,
  strictTitleScore
} from '../src/main/title-match'

describe('title-match', () => {
  it('normalise accents, ponctuation, mots vides et chiffres romains', () => {
    expect(normalizeTokens('Final Fantasy VII')).toEqual(['final', 'fantasy', '7'])
    expect(normalizeTokens("L'Odyssée d'Abe : Exoddus")).toEqual(['odyssee', 'd', 'abe', 'exoddus'])
  })

  it("ignore l'ordre des mots et la ponctuation", () => {
    expect(titleSimilarity('Legend of Zelda, The', 'The Legend of Zelda')).toBe(1)
    expect(titleSimilarity('Crash Bandicoot - Warped', 'Crash Bandicoot: Warped')).toBe(1)
  })

  it('donne 0 pour des titres vides', () => {
    expect(titleSimilarity('', 'Tekken')).toBe(0)
  })

  it('exige les mêmes numéros en mode strict', () => {
    expect(titleSimilarity('Dino Crisis', 'Dino Crisis 2')).toBeGreaterThan(0.7)
    expect(strictTitleScore('Dino Crisis', 'Dino Crisis 2')).toBe(0)
    expect(strictTitleScore('Final Fantasy VII', 'Final Fantasy 7')).toBe(1)
  })

  it('accepte des titres déjà préparés', () => {
    const a = prepareTitle('Gran Turismo 2')
    const b = prepareTitle('Gran Turismo II')
    expect(a.numbers).toBe('2')
    expect(strictTitleScore(a, b)).toBe(1)
    expect(titleSimilarity(a, 'Gran Turismo 2')).toBe(1)
  })
})
