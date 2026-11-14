import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from '../src/main/json-store'

let dir
let file

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'retrolib-json-'))
  file = join(dir, 'data.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('json-store', () => {
  it('relit ce qui a été écrit', () => {
    writeJsonFile(file, { sessions: [1, 2, 3] })
    expect(readJsonFile(file, {})).toEqual({ sessions: [1, 2, 3] })
  })

  it('renvoie la valeur par défaut si le fichier est absent', () => {
    expect(readJsonFile(file, () => ({ empty: true }))).toEqual({ empty: true })
    expect(readJsonFile(file, null)).toBeNull()
  })

  it('garde la version précédente en .bak et ne laisse pas de .tmp', () => {
    writeJsonFile(file, { version: 1 })
    writeJsonFile(file, { version: 2 })
    expect(JSON.parse(readFileSync(file + '.bak', 'utf-8'))).toEqual({ version: 1 })
    expect(existsSync(file + '.tmp')).toBe(false)
  })

  it('relit la sauvegarde si le fichier principal est tronqué', () => {
    writeJsonFile(file, { version: 1 })
    writeJsonFile(file, { version: 2 })
    writeFileSync(file, '{"version": 2, "sess', 'utf-8') // coupure en pleine écriture
    expect(readJsonFile(file, {})).toEqual({ version: 1 })
  })

  it('relit la sauvegarde si le fichier principal a disparu', () => {
    writeJsonFile(file, { version: 1 })
    writeJsonFile(file, { version: 2 })
    rmSync(file)
    expect(readJsonFile(file, {})).toEqual({ version: 1 })
  })

  it('met de côté un fichier illisible sans sauvegarde au lieu de le perdre', () => {
    writeFileSync(file, '{ pas du json', 'utf-8')
    expect(readJsonFile(file, () => ({}))).toEqual({})
    const kept = readdirSync(dir).filter((name) => name.startsWith('data.json.corrupt-'))
    expect(kept).toHaveLength(1)
    expect(readFileSync(join(dir, kept[0]), 'utf-8')).toBe('{ pas du json')
  })

  it("écrit l'indentation demandée", () => {
    writeJsonFile(file, { a: 1 }, 2)
    expect(readFileSync(file, 'utf-8')).toBe('{\n  "a": 1\n}')
  })
})
