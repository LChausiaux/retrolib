import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'

const PLAYLISTS_DIR = join(app.getPath('userData'), 'playlists')

// Pour un jeu multi-disque, génère (ou met à jour) un fichier .m3u listant chaque
// disque : DuckStation, PCSX2 et la plupart des émulateurs supportent ce format pour
// proposer le changement de disque directement en jeu (au lieu de devoir relancer
// l'émulateur à la main sur le disque suivant). Les émulateurs modernes savent lire un
// disque directement depuis son zip (pas besoin de l'extraire), donc le m3u référence
// simplement les chemins des zips tels quels.
export function ensurePlaylist(gameId, discPaths) {
  if (!existsSync(PLAYLISTS_DIR)) mkdirSync(PLAYLISTS_DIR, { recursive: true })
  const m3uPath = join(PLAYLISTS_DIR, `${gameId}.m3u`)
  const content = discPaths.join('\n') + '\n'

  // Régénéré si le contenu a changé (RomStation réinstallé/déplacé, jeu re-scanné) —
  // évite une écriture disque inutile à chaque ouverture de la bibliothèque sinon.
  const existing = existsSync(m3uPath) ? readFileSync(m3uPath, 'utf-8') : null
  if (existing !== content) writeFileSync(m3uPath, content, 'utf-8')

  return m3uPath
}

// Voir extraction.js: clearExtraction — le .m3u pointerait sinon vers des fichiers
// extraits qui n'existent plus.
export function removePlaylist(gameId) {
  rmSync(join(PLAYLISTS_DIR, `${gameId}.m3u`), { force: true })
}
