import { open } from 'fs/promises'

// Signature magique du struct Windows VS_FIXEDFILEINFO (toujours 0xFEEF04BD, quel que
// soit l'exe) et taille de ce struct en octets.
const SIGNATURE = 0xfeef04bd
const STRUCT_SIZE = 52
const CHUNK_SIZE = 1024 * 1024
const OVERLAP = 16 // pour ne pas rater une signature à cheval sur deux blocs lus

function formatVersion(ms, ls) {
  const major = (ms >>> 16) & 0xffff
  const minor = ms & 0xffff
  const build = (ls >>> 16) & 0xffff
  const revision = ls & 0xffff
  return `${major}.${minor}.${build}.${revision}`
}

// dwFileOS (WinVer.h VOS_*) : seules ces valeurs existent réellement, tout le reste ne
// peut être qu'une coïncidence d'octets ailleurs dans le binaire.
const VALID_FILE_OS = new Set([
  0x00000000, 0x00010000, 0x00020000, 0x00030000, 0x00040000, 0x00050000, 0x00000001, 0x00000002,
  0x00000003, 0x00000004, 0x00010001, 0x00010004, 0x00020002, 0x00020003, 0x00040004
])
// dwFileType (WinVer.h VFT_*).
const VALID_FILE_TYPE = new Set([0, 1, 2, 3, 4, 5, 7])

// Un vrai VS_FIXEDFILEINFO a des champs "structurels" (masques de flags, OS, type de
// fichier) tirés d'un tout petit nombre de valeurs connues. Sur un exécutable de
// quelques dizaines à quelques centaines de Mo, la signature + dwStrucVersion seules
// ne suffisent pas à exclure un faux positif (vérifié en pratique sur un electron.exe
// de 200 Mo : 2 "hits", dont un franchement invalide sur ces champs) — ce contrôle
// supplémentaire, lui, les distingue de façon fiable.
function looksLikeRealFixedFileInfo(struct) {
  const flagsMask = struct.readUInt32LE(24)
  const flags = struct.readUInt32LE(28)
  const fileOS = struct.readUInt32LE(32)
  const fileType = struct.readUInt32LE(36)
  if (flagsMask > 0x3f) return false
  if ((flags & ~flagsMask) !== 0) return false
  if (!VALID_FILE_OS.has(fileOS)) return false
  if (!VALID_FILE_TYPE.has(fileType)) return false
  return true
}

// Fenêtre scannée après le struct pour y chercher les champs texte (StringFileInfo).
// Généreux (le bloc ne fait en pratique que quelques centaines d'octets à quelques Ko
// pour l'ensemble des champs CompanyName/FileVersion/ProductName/...) pour couvrir
// aussi les binaires avec beaucoup de tables de langues.
const STRING_TABLE_WINDOW = 65536

// Beaucoup de projets ne maintiennent QUE la chaîne de texte "FileVersion"/
// "ProductVersion" (celle affichée par Windows) et laissent le champ numérique
// VS_FIXEDFILEINFO à une valeur par défaut (souvent 1.0.0.0) — vu en pratique sur
// Flycast, qui affiche "2.4" dans l'explorateur alors que son FIXEDFILEINFO numérique
// vaut 1.0.0.0. On lit donc AUSSI la chaîne, en cherchant sa clé encodée en UTF-16LE
// (le format des ressources Windows) puis en décodant la valeur qui suit.
function readUtf16StringAt(buf, offset) {
  let pos = offset
  // Le buffer des ressources aligne chaque champ sur 4 octets : on saute le
  // remplissage nul entre la clé et sa valeur.
  while (pos + 1 < buf.length && buf[pos] === 0 && buf[pos + 1] === 0) pos += 2
  const start = pos
  while (pos + 1 < buf.length && !(buf[pos] === 0 && buf[pos + 1] === 0)) pos += 2
  if (pos === start) return null
  const value = buf.toString('utf16le', start, pos).trim()
  return value || null
}

// Certains builds écrivent la chaîne au format "1, 0, 0, 2894" (calqué sur les
// paramètres bruts de la macro FILEVERSION du .rc) plutôt que "1.0.0.2894" — cosmétique
// uniquement, mais autant afficher un format cohérent avec le reste de l'interface.
function normalizeVersionString(value) {
  if (/^\d+(,\s*\d+){1,3}$/.test(value)) {
    return value
      .split(',')
      .map((part) => part.trim())
      .join('.')
  }
  return value
}

function readStringVersionField(buf, fieldName) {
  const key = Buffer.from(fieldName + '\u0000', 'utf16le')
  const idx = buf.indexOf(key)
  if (idx === -1) return null
  const value = readUtf16StringAt(buf, idx + key.length)
  return value ? normalizeVersionString(value) : value
}

async function readStringTableVersions(handle, afterOffset, fileSize) {
  const windowSize = Math.min(STRING_TABLE_WINDOW, fileSize - afterOffset)
  if (windowSize <= 0) return { fileVersionString: null, productVersionString: null }
  const buf = Buffer.alloc(windowSize)
  await handle.read(buf, 0, windowSize, afterOffset)
  return {
    fileVersionString: readStringVersionField(buf, 'FileVersion'),
    productVersionString: readStringVersionField(buf, 'ProductVersion')
  }
}

// Lit la version d'un .exe Windows (FileVersion / ProductVersion, celles qu'affiche
// l'onglet "Détails" des propriétés du fichier dans l'explorateur). On NE fait PAS un
// vrai parsing de la table de ressources PE (ça demanderait de marcher un arbre de
// répertoires de ressources puis convertir une RVA en offset fichier via la table des
// sections — beaucoup de travail pour peu de gain ici). À la place, on scanne
// directement le binaire à la recherche de la signature magique du struct
// VS_FIXEDFILEINFO : cette valeur est fixe et quasi unique dans un exécutable normal,
// donc un simple memmem suffit en pratique pour les binaires MSVC/MinGW/Qt (la quasi-
// totalité des émulateurs), qui embarquent tous cette ressource.
// Renvoie null si l'exe n'a pas cette ressource (rare, mais possible sur certains
// builds nightly/dev mal packagés) ou si le fichier est illisible.
// Asynchrone et lu par blocs : le scan d'un gros exe (plusieurs centaines de ms) ne
// bloque pas le processus principal, qui reste libre de traiter les autres IPC entre
// deux blocs (voir library.js: resolveEmulatorVersions, appelé en arrière-plan).
export async function readExeVersion(exePath) {
  let handle
  try {
    handle = await open(exePath, 'r')
  } catch {
    return null
  }
  try {
    const { size } = await handle.stat()
    let offset = 0
    let prevTail = Buffer.alloc(0)

    while (offset < size) {
      const readSize = Math.min(CHUNK_SIZE, size - offset)
      const chunk = Buffer.alloc(readSize)
      await handle.read(chunk, 0, readSize, offset)
      const buf = Buffer.concat([prevTail, chunk])
      const baseOffset = offset - prevTail.length

      for (let i = 0; i <= buf.length - 8; i++) {
        // dwStrucVersion vaut quasi toujours 0x00010000 : deuxième vérif pour éviter
        // un faux positif sur 4 octets qui ressembleraient à la signature par hasard.
        if (buf.readUInt32LE(i) === SIGNATURE && buf.readUInt32LE(i + 4) === 0x00010000) {
          const structOffset = baseOffset + i
          if (structOffset + STRUCT_SIZE > size) continue
          const struct = Buffer.alloc(STRUCT_SIZE)
          await handle.read(struct, 0, STRUCT_SIZE, structOffset)
          if (!looksLikeRealFixedFileInfo(struct)) continue
          const { fileVersionString, productVersionString } = await readStringTableVersions(
            handle,
            structOffset + STRUCT_SIZE,
            size
          )
          return {
            fileVersion: formatVersion(struct.readUInt32LE(8), struct.readUInt32LE(12)),
            productVersion: formatVersion(struct.readUInt32LE(16), struct.readUInt32LE(20)),
            // Version "humaine" telle qu'affichée par Windows (onglet Détails) : à
            // préférer au champ numérique ci-dessus, souvent laissé par défaut par le
            // build (voir commentaire sur readStringTableVersions).
            fileVersionString,
            productVersionString
          }
        }
      }

      prevTail = buf.subarray(Math.max(0, buf.length - OVERLAP))
      offset += readSize
    }
    return null
  } catch {
    return null
  } finally {
    await handle.close()
  }
}
