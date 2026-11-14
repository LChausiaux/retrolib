import { mkdirSync, readdirSync, unlinkSync, copyFileSync, renameSync, existsSync } from 'fs'
import { join, extname, dirname, basename } from 'path'
import { coverFaceOf } from './scanner-games'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])

// Un jeu ajouté "en vrac" (rom isolée directement dans le dossier downloads, sans
// sous-dossier dédié — le cas le plus courant pour les jeux Switch .nsp/.xci) n'a pas
// de "dossier du jeu" où ranger une jaquette. On lui en crée un à la volée, nommé
// d'après la rom, et on y déplace la rom : au prochain scan, ce dossier sera reconnu
// comme "dossier hors format standard avec une rom dedans" (scanGamesDirectory dans
// scanner-games.js), exactement comme un jeu ajouté manuellement dans son propre
// dossier — il aura donc désormais un folderPath comme les autres.
function createDedicatedFolder(romPath) {
  const parentDir = dirname(romPath)
  const title = basename(romPath, extname(romPath))

  let folder = join(parentDir, title)
  for (let n = 2; existsSync(folder); n++) {
    folder = join(parentDir, `${title} (${n})`)
  }

  mkdirSync(folder, { recursive: true })
  renameSync(romPath, join(folder, basename(romPath)))
  return folder
}

// Dépose l'image choisie par l'utilisateur dans le dossier "images" du jeu — la même
// convention que RomStation (voir findCover dans scanner-games.js), qui cherche là au
// prochain scan. Pas besoin de stocker un chemin séparé : la jaquette est reconnue
// dès le prochain rechargement de la bibliothèque, comme n'importe quelle jaquette
// RomStation. Si le jeu n'a pas encore de dossier dédié (rom isolée, voir
// createDedicatedFolder ci-dessus), romPath permet d'en créer un au passage.
// face = 'front' (jaquette, images/cover.*), 'back' (dos de la boîte, images/back.*)
// ou 'spine' (tranche, images/spine.*) — reconnues par coverFaceOf (scanner-games.js).
const FILE_NAMES = { front: 'cover', back: 'back', spine: 'spine' }

export function setGameCoverImage({ folderPath, romPath }, sourcePath, face = 'front') {
  if (!FILE_NAMES[face]) face = 'front'
  const resolvedFolderPath = folderPath || createDedicatedFolder(romPath)

  const imagesDir = join(resolvedFolderPath, 'images')
  mkdirSync(imagesDir, { recursive: true })

  // Retire toute jaquette existante avant d'ajouter la nouvelle : le scan ne garde de
  // toute façon que la première image trouvée (findCover), en laisser plusieurs ne
  // ferait qu'accumuler des fichiers orphelins sans jamais être affichés.
  for (const name of readdirSync(imagesDir)) {
    // Seules les images de la même face sont remplacées : changer la face avant
    // conserve le dos, et inversement.
    if (IMAGE_EXTENSIONS.has(extname(name).toLowerCase()) && coverFaceOf(name) === face) {
      unlinkSync(join(imagesDir, name))
    }
  }

  const ext = extname(sourcePath).toLowerCase() || '.png'
  const destPath = join(imagesDir, `${FILE_NAMES[face]}${ext}`)

  // Copie puis suppression de la source (déplacement manuel) plutôt qu'un renameSync :
  // la source peut être sur un autre disque que RomStation (ex: Téléchargements sur
  // C:, RomStation sur E:), ce que renameSync ne supporte pas (erreur EXDEV).
  copyFileSync(sourcePath, destPath)
  unlinkSync(sourcePath)

  // folderPath est renvoyé même quand il était déjà connu : quand createDedicatedFolder
  // vient de déplacer la rom, c'est la seule façon pour l'appelant (voir index.js /
  // App.vue) de savoir que le chemin — et donc l'id du jeu, dérivé du chemin — a changé.
  return { destPath, folderPath: resolvedFolderPath }
}
