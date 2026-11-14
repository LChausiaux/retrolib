import { readdirSync, rmSync, statSync } from 'fs'
import { join, dirname, extname, basename } from 'path'
import { readZipEntries } from './zip-peek'
import { removePlaylist } from './playlists'

// Chemins "source" d'un jeu : un par disque pour un multi-disque, sinon la rom seule.
function sourcePaths(game) {
  return Array.isArray(game.discPaths) && game.discPaths.length > 1
    ? game.discPaths
    : [game.romPath].filter(Boolean)
}

function zipsIn(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && extname(e.name).toLowerCase() === '.zip')
      .map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

function fileSize(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

// Un jeu est considéré "décompressé" dès que findPrimaryRomFile (scanner-games.js)
// préfère un fichier extrait (.cue, .bin...) au zip resté à côté : le lancement ne
// passe alors plus par extractZip (voir launcher.js: resolvePlayablePath). Une
// extraction interrompue ou corrompue reste donc "décompressée" pour toujours, d'où
// le bouton de réinitialisation de la page du jeu (voir clearExtraction).
export function isExtracted(game) {
  return sourcePaths(game).some(
    (path) => extname(path).toLowerCase() !== '.zip' && zipsIn(dirname(path)).length > 0
  )
}

// Inventaire du contenu décompressé d'un jeu, SANS rien supprimer. Règles de sécurité
// (le zip d'origine RomStation est la seule copie du jeu qu'on garde) :
// - on ne regarde que les dossiers contenant au moins un zip ;
// - si l'un de ces zips est illisible (table centrale vide ou corrompue), le dossier est
//   ignoré : les fichiers extraits pourraient être la seule copie exploitable ;
// - un fichier n'est supprimable que si un zip VOISIN contient une entrée du même nom
//   (il peut donc être ré-extrait à l'identique au prochain lancement) ;
// - jamais de .zip, jamais un fichier absent des zips (sauvegardes, images, readme...).
export function analyzeExtraction(game) {
  const files = []
  let extractedBytes = 0
  let zipBytes = 0
  let unsafeDirs = 0
  const seenDirs = new Set()

  for (const path of sourcePaths(game)) {
    const dir = dirname(path)
    if (seenDirs.has(dir)) continue
    seenDirs.add(dir)

    const zips = zipsIn(dir)
    if (zips.length === 0) continue

    const entryNames = new Set()
    let readable = true
    for (const zip of zips) {
      const entries = readZipEntries(zip).filter((e) => !e.name.endsWith('/'))
      if (entries.length === 0 || fileSize(zip) === 0) {
        readable = false
        break
      }
      for (const entry of entries) {
        entryNames.add(basename(entry.name.replace(/\\/g, '/')).toLowerCase())
      }
    }
    if (!readable) {
      unsafeDirs++
      continue
    }
    for (const zip of zips) zipBytes += fileSize(zip)

    let dirEntries = []
    try {
      dirEntries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of dirEntries) {
      if (!entry.isFile()) continue
      const name = entry.name.toLowerCase()
      if (extname(name) === '.zip' || !entryNames.has(name)) continue
      const filePath = join(dir, entry.name)
      files.push(filePath)
      extractedBytes += fileSize(filePath)
    }
  }

  return { files, extractedBytes, zipBytes, unsafeDirs }
}

// Supprime le contenu décompressé d'un jeu pour qu'il redevienne "compressé" : au
// prochain scan, findPrimaryRomFile retombe sur le zip, et le prochain lancement
// ré-extrait tout proprement. Ne supprime QUE ce qu'analyzeExtraction juge
// récupérable depuis un zip voisin lisible. Renvoie { removed, freedBytes }.
export function clearExtraction(game) {
  const { files } = analyzeExtraction(game)
  let removed = 0
  let freedBytes = 0
  for (const filePath of files) {
    const size = fileSize(filePath)
    try {
      rmSync(filePath, { force: true })
      removed++
      freedBytes += size
    } catch {
      // Fichier verrouillé (émulateur lancé hors RetroLib...) : on passe au suivant.
    }
  }
  // Le .m3u d'un multi-disque référence les fichiers extraits : il serait faux une
  // fois ceux-ci supprimés (il est de toute façon régénéré au prochain lancement).
  if (removed > 0) removePlaylist(game.id)
  return { removed, freedBytes }
}
