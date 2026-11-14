import {
  openSync,
  closeSync,
  fstatSync,
  readSync,
  createReadStream,
  createWriteStream,
  existsSync,
  statSync
} from 'fs'
import { createInflateRaw } from 'zlib'
import { join } from 'path'
import { pipeline } from 'stream/promises'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIR_SIGNATURE = 0x02014b50
const LOCAL_HEADER_SIGNATURE = 0x04034b50
const MAX_EOCD_SEARCH = 65557

// Comme zip-peek.js (table centrale seule, jamais le contenu), mais avec les champs
// nécessaires à l'extraction en plus de name/size : méthode de compression, taille
// compressée, et offset du header local de chaque entrée.
function readCentralDirectoryFull(zipPath) {
  let fd
  try {
    fd = openSync(zipPath, 'r')
  } catch {
    return []
  }
  try {
    const size = fstatSync(fd).size
    const tailSize = Math.min(size, MAX_EOCD_SEARCH)
    const tail = Buffer.alloc(tailSize)
    readSync(fd, tail, 0, tailSize, size - tailSize)

    let eocdOffset = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocdOffset = i
        break
      }
    }
    if (eocdOffset === -1) return []

    const entryCount = tail.readUInt16LE(eocdOffset + 10)
    const centralDirSize = tail.readUInt32LE(eocdOffset + 12)
    const centralDirOffset = tail.readUInt32LE(eocdOffset + 16)

    const centralDir = Buffer.alloc(centralDirSize)
    readSync(fd, centralDir, 0, centralDirSize, centralDirOffset)

    const entries = []
    let pos = 0
    for (let i = 0; i < entryCount; i++) {
      if (pos + 46 > centralDir.length || centralDir.readUInt32LE(pos) !== CENTRAL_DIR_SIGNATURE) {
        break
      }
      const method = centralDir.readUInt16LE(pos + 10)
      const compressedSize = centralDir.readUInt32LE(pos + 20)
      const uncompressedSize = centralDir.readUInt32LE(pos + 24)
      const nameLen = centralDir.readUInt16LE(pos + 28)
      const extraLen = centralDir.readUInt16LE(pos + 30)
      const commentLen = centralDir.readUInt16LE(pos + 32)
      const localHeaderOffset = centralDir.readUInt32LE(pos + 42)
      const name = centralDir.toString('utf8', pos + 46, pos + 46 + nameLen)
      entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset })
      pos += 46 + nameLen + extraLen + commentLen
    }
    return entries
  } catch {
    return []
  } finally {
    closeSync(fd)
  }
}

// Offset exact du début des données compressées : on relit le header LOCAL de
// l'entrée (pas celui de la table centrale) car son nom/extra peuvent différer en
// longueur (Zip64 notamment) — on ne peut pas supposer qu'ils correspondent.
function dataOffsetFor(fd, entry) {
  const header = Buffer.alloc(30)
  readSync(fd, header, 0, 30, entry.localHeaderOffset)
  if (header.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`Header local invalide pour ${entry.name}`)
  }
  const nameLen = header.readUInt16LE(26)
  const extraLen = header.readUInt16LE(28)
  return entry.localHeaderOffset + 30 + nameLen + extraLen
}

function baseName(entryName) {
  const parts = entryName.split(/[/\\]/)
  return parts[parts.length - 1]
}

// Extrait toutes les entrées "fichier" d'un zip directement dans destDir, à plat (les
// zips RomStation n'ont pas de sous-dossiers internes). Idempotent : une entrée déjà
// présente sur disque avec la bonne taille n'est pas ré-extraite — appelable à chaque
// lancement sans coût une fois le jeu extrait une première fois. Décompression en
// flux (jamais tout en mémoire) : indispensable, les .bin de disque font de quelques
// centaines de Mo (PS1) à plusieurs Go (PS2/GameCube).
//
// onProgress(fraction) est appelé régulièrement pendant l'extraction (0 → 1), basé sur
// les octets COMPRESSÉS déjà lus (plus simple à suivre en flux que la taille
// décompressée) — sert à afficher une barre de progression côté interface.
export async function extractZip(zipPath, destDir, onProgress) {
  const entries = readCentralDirectoryFull(zipPath).filter((e) => !e.name.endsWith('/'))
  const extracted = []

  const pending = entries.filter((entry) => {
    const outPath = join(destDir, baseName(entry.name))
    return !(existsSync(outPath) && statSync(outPath).size === entry.uncompressedSize)
  })

  // Rien à décompresser (déjà extrait lors d'un lancement précédent) : on signale
  // quand même "terminé" pour que l'appelant puisse effacer une éventuelle barre.
  if (pending.length === 0) {
    onProgress?.(1)
    return entries.map((entry) => join(destDir, baseName(entry.name)))
  }

  const totalBytes = pending.reduce((sum, entry) => sum + entry.compressedSize, 0) || 1
  let bytesDone = 0

  for (const entry of entries) {
    const outPath = join(destDir, baseName(entry.name))
    if (existsSync(outPath) && statSync(outPath).size === entry.uncompressedSize) {
      extracted.push(outPath)
      continue
    }

    const fd = openSync(zipPath, 'r')
    let offset
    try {
      offset = dataOffsetFor(fd, entry)
    } finally {
      closeSync(fd)
    }

    const source = createReadStream(zipPath, {
      start: offset,
      end: offset + entry.compressedSize - 1
    })
    source.on('data', (chunk) => {
      bytesDone += chunk.length
      onProgress?.(Math.min(bytesDone / totalBytes, 1))
    })
    const dest = createWriteStream(outPath)

    if (entry.method === 0) {
      // Stocké sans compression : copie directe.
      await pipeline(source, dest)
    } else if (entry.method === 8) {
      // DEFLATE : quasi toujours la méthode utilisée par les zips RomStation.
      await pipeline(source, createInflateRaw(), dest)
    } else {
      throw new Error(
        `Méthode de compression zip non supportée (${entry.method}) pour ${entry.name}`
      )
    }

    extracted.push(outPath)
  }

  onProgress?.(1)

  return extracted
}

// Flux décompressé d'une entrée d'un zip, lue sans l'extraire sur disque (sert à
// parcourir la base LaunchBox, un XML de ~500 Mo, voir launchbox-db.js). Renvoie null
// si l'entrée est absente.
export function openZipEntryStream(zipPath, entryName) {
  const entry = readCentralDirectoryFull(zipPath).find((e) => e.name === entryName)
  if (!entry) return null
  const fd = openSync(zipPath, 'r')
  let offset
  try {
    offset = dataOffsetFor(fd, entry)
  } finally {
    closeSync(fd)
  }
  const source = createReadStream(zipPath, {
    start: offset,
    end: offset + entry.compressedSize - 1
  })
  if (entry.method === 0) return source
  if (entry.method === 8) return source.pipe(createInflateRaw())
  throw new Error(`Méthode de compression zip non supportée (${entry.method}) pour ${entryName}`)
}
