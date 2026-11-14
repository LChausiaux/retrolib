import { readdirSync, statSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { guessPlatformFromFile } from './platforms'
import { readZipEntries } from './zip-peek'
import romstationCatalog from './data/romstation-catalog.json'

const IGNORED_ENTRIES = new Set(['readme.txt', 'switch covers', '.ds_store'])

export const ROM_LIKE_EXTENSIONS = new Set([
  '.bin',
  '.cue',
  '.iso',
  '.chd',
  '.pbp',
  '.gdi',
  '.cdi',
  '.z64',
  '.n64',
  '.v64',
  '.sfc',
  '.smc',
  '.gba',
  '.gb',
  '.gbc',
  '.nds',
  '.3ds',
  '.cci',
  '.cxi',
  '.nsp',
  '.xci',
  '.rvz',
  '.wbfs',
  '.wud',
  '.wux',
  '.wua',
  '.pkg'
])

// La grande majorité des jeux téléchargés via le catalogue RomStation ne sont PAS
// stockés en clair : ils restent compressés en .zip (nom de fichier générique type
// "34178.zip", sans aucun indice de plateforme) jusqu'à ce que RomStation lui-même
// les décompresse. On les reconnaît comme candidats mais leur plateforme doit être
// devinée en regardant DANS l'archive (voir resolvePlatform ci-dessous) — sauf si le
// catalogue extrait de la base RomStation (voir romstation-catalog.json) connaît déjà
// ce jeu, auquel cas il est prioritaire (source fiable à 100%, contrairement à la
// simple heuristique sur le nom de fichier interne).
const ARCHIVE_EXTENSIONS = new Set(['.zip'])

const ALL_CANDIDATE_EXTENSIONS = new Set([...ROM_LIKE_EXTENSIONS, ...ARCHIVE_EXTENSIONS])

// Format standard d'un dossier de jeu téléchargé via le catalogue RomStation :
// "<Titre> - <id numérique>"
const STANDARD_FOLDER_RE = /^(.*) - (\d+)$/

// Face de la boîte représentée par une image du dossier "images" : "back.png",
// "dos.jpg", "<titre> - back.png" -> dos ; "spine.png", "tranche.jpg" -> tranche
// (conventions de game-cover.js). Toute autre image est une face avant (convention
// RomStation).
export function coverFaceOf(name) {
  const base = name.replace(/\.[^.]+$/, '')
  if (/(^|[\s_.-])(back|dos|verso)$/i.test(base)) return 'back'
  if (/(^|[\s_.-])(spine|tranche)$/i.test(base)) return 'spine'
  return 'front'
}

function findCovers(dir) {
  const imagesDir = join(dir, 'images')
  const none = { coverPath: null, backCoverPath: null, spineCoverPath: null }
  if (!existsSync(imagesDir)) return none
  const images = readdirSync(imagesDir).filter((f) => /\.(png|jpe?g)$/i.test(f))
  const pick = (face) => {
    const found = images.find((f) => coverFaceOf(f) === face)
    return found ? join(imagesDir, found) : null
  }
  return { coverPath: pick('front'), backCoverPath: pick('back'), spineCoverPath: pick('spine') }
}

// Cherche le fichier "principal" d'un jeu dans un dossier : préfère un .cue (qui
// pointe vers un .bin), puis la plus grosse rom reconnue directement, et seulement en
// dernier recours une archive .zip (le cas le plus fréquent en pratique).
export function findPrimaryRomFile(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const files = entries.filter((e) => e.isFile())

  const cue = files.find((f) => extname(f.name).toLowerCase() === '.cue')
  if (cue) return join(dir, cue.name)

  const pickBiggest = (extSet) => {
    let best = null
    let bestSize = -1
    for (const f of files) {
      if (!extSet.has(extname(f.name).toLowerCase())) continue
      const size = statSync(join(dir, f.name)).size
      if (size > bestSize) {
        best = join(dir, f.name)
        bestSize = size
      }
    }
    return best
  }

  return pickBiggest(ROM_LIKE_EXTENSIONS) || pickBiggest(ARCHIVE_EXTENSIONS)
}

// Devine la plateforme d'une rom. Si c'est un .zip (cas le plus fréquent), on ne peut
// rien déduire du nom du fichier lui-même ("34178.zip") : on regarde donc la table
// centrale de l'archive (sans la décompresser, voir zip-peek.js) pour trouver le nom
// du vrai fichier à l'intérieur (ex: "Devil May Cry.ISO") et deviner à partir de lui.
function resolvePlatform(romPath) {
  const ext = extname(romPath).toLowerCase()
  if (ext !== '.zip') return guessPlatformFromFile(romPath)

  const entries = readZipEntries(romPath).filter((e) => !e.name.endsWith('/'))
  let best = null
  let bestSize = -1
  for (const entry of entries) {
    const platform = guessPlatformFromFile(entry.name)
    if (platform && entry.size > bestSize) {
      best = platform
      bestSize = entry.size
    }
  }
  return best
}

function scanStandardGameFolder(dir, folderTitle, romId) {
  const filesDir = join(dir, 'files')
  if (!existsSync(filesDir)) return null

  // Le contenu réel est dans files/<id interne>/ : un seul sous-dossier pour un jeu
  // mono-disque, PLUSIEURS pour un jeu multi-disque — un sous-dossier par disque (ex.
  // Final Fantasy VII : files/1237, files/1239, files/1241 pour les disques 1/2/3, avec
  // les zips 620a.zip/620b.zip/620c.zip correspondants). Ne garder que le premier
  // planterait le changement de disque en jeu. Les ID de sous-dossiers sont attribués
  // dans l'ordre des disques (confirmé sur plusieurs jeux : lettre de zip a/b/c/d en
  // ordre croissant des ID) donc un tri numérique des noms de dossier suffit à retrouver
  // le bon ordre, pas besoin d'inspecter le contenu des zips.
  const subEntries = readdirSync(filesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  let romPath
  let discPaths = null

  if (subEntries.length > 1) {
    const discs = subEntries
      .map((entry) => findPrimaryRomFile(join(filesDir, entry.name)))
      .filter(Boolean)
    if (discs.length > 1) {
      discPaths = discs
      romPath = discs[0]
    } else {
      romPath = discs[0] || null
    }
  } else {
    const romDir = subEntries.length ? join(filesDir, subEntries[0].name) : filesDir
    romPath = findPrimaryRomFile(romDir)
  }

  if (!romPath) return null

  // Le catalogue extrait de la base RomStation (table GAME : SYSTEM_ID, TITLE, YEAR)
  // donne les vraies métadonnées pour tout jeu téléchargé via le catalogue : c'est la
  // source la plus fiable, aussi bien pour la plateforme (fiabilité garantie, contrairement
  // à l'heuristique par extension/zip) que pour le titre (mieux formaté que celui déduit
  // du nom de dossier) et l'année de sortie. On ne retombe sur l'heuristique/le nom de
  // dossier que pour les jeux absents du catalogue (ajoutés manuellement, ou catalogue
  // pas encore régénéré).
  const dbEntry = romstationCatalog[romId]
  const platform = dbEntry?.platform || resolvePlatform(romPath)

  return {
    id: `game-${romId}`,
    title: dbEntry?.title || folderTitle,
    romPath,
    discPaths,
    ...findCovers(dir),
    // Dossier racine du jeu (celui qui contient "files/" et "images/") : sert à
    // déposer une jaquette choisie manuellement au bon endroit (voir game-cover.js),
    // au même endroit que RomStation range les siennes.
    folderPath: dir,
    platform,
    year: dbEntry?.year || null,
    developer: dbEntry?.developer || null,
    publisher: dbEntry?.publisher || null
  }
}

// Scanne récursivement (avec une profondeur limitée) le dossier "downloads" des jeux
// RomStation. Ignore silencieusement ce qu'il ne reconnaît pas plutôt que de planter :
// l'installation réelle contient des cas hors catalogue (fichiers ajoutés à la main,
// dumps de disque complets) qui ne suivent aucun format prévisible.
export function scanGamesDirectory(dir, depth = 0) {
  if (depth > 1) return [] // filet de sécurité : on ne descend pas dans des dumps de disque profonds
  const games = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return games
  }

  for (const entry of entries) {
    const name = entry.name
    if (IGNORED_ENTRIES.has(name.toLowerCase())) continue
    const entryPath = join(dir, name)

    if (entry.isDirectory()) {
      const match = name.match(STANDARD_FOLDER_RE)
      if (match) {
        const [, title, romId] = match
        const game = scanStandardGameFolder(entryPath, title, romId)
        if (game) games.push(game)
        continue
      }

      // Dossier hors format standard : soit un jeu ajouté manuellement (une rom
      // directement dedans), soit un dossier imbriqué contenant d'autres jeux au
      // format standard (rencontré tel quel dans l'installation réelle). On tente
      // d'abord de le traiter comme un jeu isolé, sinon on descend dedans une fois.
      const looseRom = findPrimaryRomFile(entryPath)
      if (looseRom) {
        games.push({
          id: `game-${Buffer.from(entryPath).toString('base64url')}`,
          title: name,
          romPath: looseRom,
          ...findCovers(entryPath),
          // Dossier du jeu (voir le commentaire équivalent dans scanStandardGameFolder
          // ci-dessus) : ici c'est le dossier "hors format standard" lui-même.
          folderPath: entryPath,
          platform: resolvePlatform(looseRom)
        })
      } else {
        games.push(...scanGamesDirectory(entryPath, depth + 1))
      }
    } else {
      const ext = extname(name).toLowerCase()
      // Un .bin isolé (hors dossier files/<id>/ standard) est quasi toujours un
      // fichier annexe (ex: certificats de cartouche Switch), jamais un jeu complet
      // à lui seul dans cette installation : on l'ignore à ce niveau.
      if (!ALL_CANDIDATE_EXTENSIONS.has(ext) || ext === '.bin') continue
      games.push({
        id: `game-${Buffer.from(entryPath).toString('base64url')}`,
        title: name.slice(0, name.length - ext.length),
        romPath: entryPath,
        coverPath: null,
        backCoverPath: null,
        spineCoverPath: null,
        platform: resolvePlatform(entryPath)
      })
    }
  }

  return games
}
