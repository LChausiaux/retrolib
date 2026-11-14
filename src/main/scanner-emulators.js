import { readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const HELPER_EXE_BLACKLIST = new Set([
  'updater.exe',
  'uninstaller.exe',
  'uninst.exe',
  'unins000.exe',
  'unins001.exe',
  'elevate.exe',
  'crashpad_handler.exe',
  'vc_redist.x64.exe',
  'vc_redist.x86.exe'
])

// Parcourt récursivement (profondeur limitée) un dossier d'émulateur et collecte tous
// les .exe candidats. La structure interne de chaque émulateur RomStation varie
// beaucoup (files/<version>/, files/<version>/publish/, exe directement à la racine,
// un dossier "master"...) donc on ne suppose rien et on cherche partout plutôt que de
// coder en dur un chemin précis.
function collectExeCandidates(dir, depth, results) {
  if (depth > 6) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectExeCandidates(entryPath, depth + 1, results)
    } else if (extname(entry.name).toLowerCase() === '.exe') {
      if (HELPER_EXE_BLACKLIST.has(entry.name.toLowerCase())) continue
      results.push({ path: entryPath, name: entry.name, size: statSync(entryPath).size })
    }
  }
}

// Parmi les .exe trouvés, privilégie ceux dont le nom contient celui du dossier de
// l'émulateur (ex: "azahar" dans azahar.exe ET azahar-room.exe), puis prend le plus
// gros du lot restant (l'exécutable principal/GUI est quasi toujours le plus lourd,
// ex: eden.exe 69 Mo vs eden-cli.exe 41 Mo).
function pickMainExecutable(candidates, emulatorFolderName) {
  if (candidates.length === 0) return null
  const keyword = emulatorFolderName.toLowerCase().replace(/[^a-z0-9]/g, '')
  const keywordMatches = candidates.filter((c) =>
    c.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(keyword)
  )
  const pool = keywordMatches.length ? keywordMatches : candidates
  return pool.reduce((biggest, c) => (c.size > biggest.size ? c : biggest), pool[0]).path
}

// Scanne app/emulators/downloads/ et retourne { "DuckStation": "C:\...\duckstation-....exe", ... }
export function scanInstalledEmulators(emulatorsDownloadsPath) {
  const result = {}
  let emulatorDirs
  try {
    emulatorDirs = readdirSync(emulatorsDownloadsPath, { withFileTypes: true }).filter((e) =>
      e.isDirectory()
    )
  } catch {
    return result
  }

  for (const emulatorDir of emulatorDirs) {
    const rootPath = join(emulatorsDownloadsPath, emulatorDir.name)
    const candidates = []
    collectExeCandidates(rootPath, 0, candidates)
    const exePath = pickMainExecutable(candidates, emulatorDir.name)
    if (exePath) result[emulatorDir.name] = exePath
  }

  return result
}
