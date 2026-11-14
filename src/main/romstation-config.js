import { readFileSync, existsSync } from 'fs'
import { join, isAbsolute } from 'path'

// Parseur minimal de fichier .properties Java (clé=valeur, commentaires #, ":" et "\"
// échappés par un backslash). Suffisant pour romstation.properties.
function parseProperties(content) {
  const result = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) continue
    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    value = value.replace(/\\:/g, ':').replace(/\\\\/g, '\\')
    result[key] = value
  }
  return result
}

// Lit app/config/romstation.properties et résout les chemins réels des jeux et des
// émulateurs. path.games est stocké en absolu par RomStation ; path.emulators est
// relatif à app/ et pointe vers le dossier "emulators" (les émulateurs installés sont
// eux dans emulators/downloads/, d'où le join supplémentaire ci-dessous).
export function readRomStationConfig(installRoot) {
  const propsPath = join(installRoot, 'app', 'config', 'romstation.properties')
  if (!existsSync(propsPath)) {
    throw new Error(`Fichier de config RomStation introuvable : ${propsPath}`)
  }
  const props = parseProperties(readFileSync(propsPath, 'utf-8'))
  const appRoot = join(installRoot, 'app')

  const resolvePath = (value, fallback) => {
    if (!value) return fallback
    return isAbsolute(value) ? value : join(appRoot, value)
  }

  const gamesPath = resolvePath(props['path.games'], join(appRoot, 'games', 'downloads'))
  const emulatorsRoot = resolvePath(props['path.emulators'], join(appRoot, 'emulators'))

  return {
    installRoot,
    appRoot,
    gamesPath,
    emulatorsPath: join(emulatorsRoot, 'downloads')
  }
}
