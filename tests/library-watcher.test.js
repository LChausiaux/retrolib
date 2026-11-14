import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { libraryFingerprint, createLibraryWatcher } from '../src/main/library-watcher'

describe('libraryFingerprint', () => {
  const a = { id: 'game-1', romPath: 'a.zip', coverPath: 'a.png' }
  const b = { id: 'game-2', romPath: 'b.cue', discPaths: ['b1', 'b2'] }

  it("ne dépend pas de l'ordre du scan", () => {
    expect(libraryFingerprint([a, b])).toBe(libraryFingerprint([b, a]))
  })

  it('change quand un jeu, son fichier ou sa jaquette change', () => {
    const base = libraryFingerprint([a, b])
    expect(libraryFingerprint([a])).not.toBe(base)
    expect(libraryFingerprint([{ ...a, romPath: 'a.cue' }, b])).not.toBe(base)
    expect(libraryFingerprint([{ ...a, backCoverPath: 'back.png' }, b])).not.toBe(base)
  })
})

describe('createLibraryWatcher', () => {
  let dir
  let watcher

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'retrolib-watch-'))
  })

  afterEach(() => {
    watcher?.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  async function waitFor(predicate, timeoutMs = 3000) {
    const started = Date.now()
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) throw new Error('délai dépassé')
      await sleep(20)
    }
  }

  it('prévient quand le contenu affiché change, une seule fois par rafale', async () => {
    let scanned = [{ id: 'game-1', romPath: 'a.zip' }]
    let changes = 0
    watcher = createLibraryWatcher({
      onChange: () => changes++,
      quietDelayMs: 50,
      scan: () => scanned
    })
    watcher.update(dir, libraryFingerprint(scanned))

    // Écriture sans effet sur la bibliothèque : pas d'événement.
    writeFileSync(join(dir, 'readme.txt'), 'x')
    await sleep(300)
    expect(changes).toBe(0)

    // Nouveau jeu : un seul événement malgré plusieurs écritures.
    scanned = [...scanned, { id: 'game-2', romPath: 'b.zip' }]
    writeFileSync(join(dir, 'b.zip'), '1')
    writeFileSync(join(dir, 'b.zip'), '12')
    await waitFor(() => changes > 0)
    await sleep(200)
    expect(changes).toBe(1)
  })
})
