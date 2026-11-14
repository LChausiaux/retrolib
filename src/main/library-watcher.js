import { watch } from 'fs'
import { scanGamesDirectory } from './scanner-games'

// Détection automatique des jeux ajoutés, supprimés ou modifiés dans le dossier des
// jeux RomStation (téléchargement terminé dans RomStation, jaquette ajoutée...), sans
// avoir à relancer le scan à la main.
//
// fs.watch (récursif, géré nativement sous Windows) signale chaque écriture : pendant
// un téléchargement ou une décompression, des centaines d'événements. On attend donc
// que le dossier soit calme quelques secondes, puis on compare une empreinte de la
// bibliothèque (jeux, fichiers principaux, jaquettes) à la précédente : la fenêtre
// n'est prévenue que si quelque chose de visible a vraiment changé.

const QUIET_DELAY_MS = 5000

// Empreinte de ce qui s'affiche dans la bibliothèque pour une liste de jeux bruts
// (scanGamesDirectory) : indépendante de l'ordre du scan.
export function libraryFingerprint(rawGames) {
  return rawGames
    .map((game) =>
      [
        game.id,
        game.romPath,
        game.coverPath || '',
        game.backCoverPath || '',
        game.spineCoverPath || '',
        Array.isArray(game.discPaths) ? game.discPaths.length : 1
      ].join('|')
    )
    .sort()
    .join('\n')
}

// onChange() : appelé quand la bibliothèque a changé sur le disque.
export function createLibraryWatcher({ onChange, quietDelayMs = QUIET_DELAY_MS, scan }) {
  const scanDirectory = scan || scanGamesDirectory
  let watcher = null
  let watchedPath = null
  let fingerprint = null
  let timer = null

  function stop() {
    clearTimeout(timer)
    timer = null
    watcher?.close()
    watcher = null
    watchedPath = null
  }

  function check() {
    timer = null
    if (!watchedPath) return
    let current
    try {
      current = libraryFingerprint(scanDirectory(watchedPath))
    } catch {
      return
    }
    if (current === fingerprint) return
    fingerprint = current
    onChange()
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(check, quietDelayMs)
  }

  // À appeler après chaque construction de la bibliothèque : (re)démarre la
  // surveillance si le dossier a changé et mémorise l'empreinte de ce qui est affiché.
  function update(gamesPath, currentFingerprint) {
    fingerprint = currentFingerprint
    if (gamesPath === watchedPath && watcher) return
    stop()
    if (!gamesPath) return
    try {
      watcher = watch(gamesPath, { recursive: true }, schedule)
      watchedPath = gamesPath
      // Dossier supprimé, disque débranché... : la surveillance reprendra au prochain
      // scan (update rappelé par le chargement de la bibliothèque).
      watcher.on('error', stop)
    } catch {
      // Dossier inaccessible ou système de fichiers sans surveillance : le bouton
      // "Relancer le scan" reste disponible.
      watcher = null
      watchedPath = null
    }
  }

  return { update, stop }
}
