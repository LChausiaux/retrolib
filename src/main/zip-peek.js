import { openSync, closeSync, fstatSync, readSync } from 'fs'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIR_SIGNATURE = 0x02014b50
const MAX_EOCD_SEARCH = 65557 // taille max de l'EOCD + commentaire

// Lit uniquement la table centrale d'un fichier .zip (jamais son contenu compressé)
// pour connaître les noms et tailles des fichiers qu'il contient, sans le
// décompresser. Utile ici pour deviner la plateforme d'un jeu téléchargé par
// RomStation sous forme de .zip (nom de fichier générique type "34178.zip") en
// regardant le nom du fichier réel à l'intérieur (ex: "Devil May Cry.ISO").
// Ne lance jamais d'exception : retourne [] si le fichier n'est pas un zip valide.
export function readZipEntries(zipPath) {
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
      const uncompressedSize = centralDir.readUInt32LE(pos + 24)
      const nameLen = centralDir.readUInt16LE(pos + 28)
      const extraLen = centralDir.readUInt16LE(pos + 30)
      const commentLen = centralDir.readUInt16LE(pos + 32)
      const name = centralDir.toString('utf8', pos + 46, pos + 46 + nameLen)
      entries.push({ name, size: uncompressedSize })
      pos += 46 + nameLen + extraLen + commentLen
    }
    return entries
  } catch {
    return []
  } finally {
    closeSync(fd)
  }
}
