import { spawn } from 'child_process'
import { dirname, extname, resolve } from 'path'
import { extractZip } from './zip-extract'
import { findPrimaryRomFile } from './scanner-games'
import { ensurePlaylist } from './playlists'
import { focusProcessWindow } from './window-focus'

// La quasi-totalité des jeux téléchargés via le catalogue RomStation restent
// compressés en .zip (jamais extraits par RomStation tant qu'on ne les lance pas
// depuis SON interface) : la plupart des émulateurs ne savent PAS lire un disque
// directement depuis un zip en ligne de commande. On extrait donc ici, à la demande,
// avant de lancer — une seule fois par jeu (extractZip est idempotent : les lancements
// suivants ne ré-extraient rien), dans le même dossier que le zip.
async function resolvePlayablePath(path, onProgress) {
  if (extname(path).toLowerCase() !== '.zip') {
    onProgress?.(1)
    return path
  }
  const dir = dirname(path)
  await extractZip(path, dir, onProgress)
  // Une fois extrait, le .cue (ou la plus grosse rom reconnue) est maintenant présent
  // à côté du zip : findPrimaryRomFile le préfère automatiquement au zip lui-même.
  const resolved = findPrimaryRomFile(dir)
  return resolved && extname(resolved).toLowerCase() !== '.zip' ? resolved : path
}

// Émulateurs lancés depuis RetroLib et encore ouverts, par chemin d'exécutable
// normalisé -> { gameId, label, child }. gameId/label valent null pour l'émulateur
// ouvert seul (page Émulateurs). Empêche d'ouvrir deux fois le même jeu ou le même
// émulateur : le verrou est posé dès la demande de lancement, AVANT l'éventuelle
// extraction du zip (child vaut alors null), pour bloquer aussi un second clic pendant
// la décompression ; il est levé à la fermeture du processus de l'émulateur.
// Limite : un émulateur ouvert en dehors de RetroLib n'est pas détecté.
const runningEmulators = new Map()

function emulatorKey(emulatorPath) {
  const normalized = resolve(emulatorPath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

// Erreur "déjà ouvert" : si c'est exactement ce qu'on demande qui tourne déjà (même
// jeu, ou l'émulateur seul), on ramène simplement sa fenêtre au premier plan au lieu
// d'afficher une erreur — voir window-focus.js. Renvoie true si c'est le cas.
async function focusIfSame(entry, gameId) {
  if (!entry.child?.pid) return false
  const sameTarget = gameId === null || entry.gameId === gameId
  if (!sameTarget) return false
  await focusProcessWindow(entry.child.pid)
  return true
}

function busyError(entry) {
  if (!entry.child) {
    return new Error(
      entry.label
        ? `"${entry.label}" est déjà en cours de lancement, patiente quelques instants.`
        : "L'émulateur est déjà en cours de lancement."
    )
  }
  return new Error(
    entry.label
      ? `"${entry.label}" est déjà en cours d'exécution avec cet émulateur : ferme-le avant de lancer autre chose.`
      : "Cet émulateur est déjà ouvert : ferme-le avant d'y lancer un jeu."
  )
}

// Renvoie null si l'émulateur tournait déjà sur la même cible (fenêtre ramenée au
// premier plan, rien à lancer), sinon un verrou { attach(child), release() }.
async function acquireEmulator(emulatorPath, gameId, label) {
  const key = emulatorKey(emulatorPath)
  const existing = runningEmulators.get(key)
  if (existing) {
    if (await focusIfSame(existing, gameId)) return null
    throw busyError(existing)
  }
  const entry = { gameId, label, child: null }
  runningEmulators.set(key, entry)
  let released = false
  const release = () => {
    if (released) return
    released = true
    if (runningEmulators.get(key) === entry) runningEmulators.delete(key)
  }
  return {
    release,
    attach(child) {
      entry.child = child
      child.once('exit', release)
      child.once('error', release)
    }
  }
}

// Jeu en cours de lancement (décompression) ou d'exécution : ses fichiers extraits ne
// doivent pas être supprimés (voir extraction.js / page Stockage).
export function isGameBusy(gameId) {
  for (const entry of runningEmulators.values()) {
    if (entry.gameId === gameId) return true
  }
  return false
}

// Découpe une chaîne d'arguments façon ligne de commande : espace = séparateur,
// guillemets doubles pour un argument contenant des espaces (ex: --config "C:\\mon
// dossier\\cfg.ini"). Utilisé pour les arguments personnalisés de la page de config
// (voir config.js: getEmulatorLaunchOptions), jamais pour le chemin de la rom
// lui-même (qui n'a pas besoin d'être re-découpé).
function parseArgString(str) {
  if (!str) return []
  const args = []
  const regex = /"([^"]*)"|(\S+)/g
  let match
  while ((match = regex.exec(str)) !== null) {
    args.push(match[1] !== undefined ? match[1] : match[2])
  }
  return args
}

// Combine les arguments personnalisés d'un émulateur (page de config) au chemin de
// la rom : si {rom} apparaît quelque part dans les arguments, il est remplacé à cet
// endroit précis (utile quand l'émulateur attend la rom avant certains flags) ;
// sinon la rom est simplement ajoutée à la fin, ce qui couvre le cas le plus courant.
function buildLaunchArgs(target, customArgs) {
  const parsed = parseArgString(customArgs)
  if (parsed.some((arg) => arg.includes('{rom}'))) {
    return parsed.map((arg) => arg.replaceAll('{rom}', target))
  }
  return [...parsed, target]
}

// Bouton "Ouvrir l'émulateur" de la page Émulateurs : lance l'émulateur seul, sans
// jeu, pour le configurer ou vérifier qu'il démarre correctement. standaloneArgs
// (page de config dédiée) permet de passer des flags utiles même sans jeu, ex.
// --big-picture ou --portable.
export async function openEmulator(emulatorPath, standaloneArgs) {
  if (!emulatorPath) {
    throw new Error('Aucun émulateur à ouvrir pour cette plateforme')
  }
  const lock = await acquireEmulator(emulatorPath, null, null)
  if (!lock) return
  let child
  try {
    child = spawn(emulatorPath, parseArgString(standaloneArgs), {
      detached: true,
      stdio: 'ignore',
      cwd: dirname(emulatorPath)
    })
  } catch (error) {
    lock.release()
    throw error
  }
  lock.attach(child)
  child.unref()
}

// discIndex : disque choisi dans le popup de sélection (App.vue) pour un jeu
// multi-disque, ignoré sinon. La plupart des émulateurs compatibles .m3u démarrent
// sur la première entrée de la playlist : on met donc le disque choisi en tête, ce
// qui permet de démarrer directement dessus tout en gardant les autres disques
// accessibles ensuite via le changeur de disque de l'émulateur.
// onProgress({ discIndex, discCount, fraction }) est appelé pendant la décompression
// de chaque disque (voir resolvePlayablePath / extractZip) — permet d'afficher une
// barre de progression côté interface pendant le premier lancement d'un jeu.
export async function launchGame(game, discIndex = 0, onProgress) {
  if (!game.emulatorPath) {
    throw new Error(`Impossible de lancer "${game.title}" : aucun émulateur détecté`)
  }

  const allSources =
    Array.isArray(game.discPaths) && game.discPaths.length > 1 ? game.discPaths : [game.romPath]

  if (!allSources[0]) {
    throw new Error(`Impossible de lancer "${game.title}" : rom introuvable`)
  }

  const chosenIndex =
    Number.isInteger(discIndex) && discIndex >= 0 && discIndex < allSources.length ? discIndex : 0
  const sources =
    allSources.length > 1
      ? [allSources[chosenIndex], ...allSources.filter((_, i) => i !== chosenIndex)]
      : allSources

  // null : le jeu tournait déjà, sa fenêtre a été ramenée au premier plan.
  const lock = await acquireEmulator(game.emulatorPath, game.id, game.title)
  if (!lock) return null
  try {
    const child = await spawnGame(game, sources, onProgress)
    lock.attach(child)
    return child
  } catch (error) {
    lock.release()
    throw error
  }
}

async function spawnGame(game, sources, onProgress) {
  const playablePaths = []
  for (let i = 0; i < sources.length; i++) {
    playablePaths.push(
      await resolvePlayablePath(sources[i], (fraction) =>
        onProgress?.({ discIndex: i, discCount: sources.length, fraction })
      )
    )
  }

  // Jeu multi-disque : le .m3u référence maintenant les fichiers extraits (pas les
  // zips), régénéré à chaque lancement au cas où l'extraction vient de se faire ou
  // que le disque de départ choisi a changé.
  const target =
    playablePaths.length > 1 ? ensurePlaylist(game.id, playablePaths) : playablePaths[0]

  const child = spawn(game.emulatorPath, buildLaunchArgs(target, game.emulatorLaunchArgs), {
    detached: true,
    stdio: 'ignore',
    cwd: dirname(game.emulatorPath)
  })
  child.unref()
  // Renvoyé pour le suivi du temps de jeu (voir stats.js: trackGameSession), qui
  // écoute la fermeture du processus de l'émulateur.
  return child
}
