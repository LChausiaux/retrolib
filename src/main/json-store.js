import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync
} from 'fs'

// Lecture / écriture fiables des fichiers JSON de RetroLib (réglages, stats, caches).
//
// Écrire directement par-dessus le fichier (writeFileSync) laisse un JSON tronqué si
// le PC s'éteint pendant l'écriture ; la lecture suivante échouait alors en silence
// et la sauvegarde d'après remplaçait définitivement tout l'historique par un fichier
// vide. Ici :
//   - écriture dans "<fichier>.tmp", vidée sur le disque (fsync), puis renommée à la
//     place du fichier (opération atomique) : le fichier est toujours soit l'ancienne
//     version complète, soit la nouvelle ;
//   - la version précédente est gardée en "<fichier>.bak", relue si le fichier
//     principal est illisible ou absent ;
//   - si les deux sont illisibles, le fichier abîmé est mis de côté
//     ("<fichier>.corrupt-<date>") au lieu d'être écrasé à la prochaine sauvegarde.
//
// Volontairement sans dépendance à Electron : testé par Vitest (voir tests/).

const RENAME_ATTEMPTS = 5
const RENAME_DELAY_MS = 25

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Sous Windows, un antivirus ou l'indexeur peut garder le fichier ouvert un court
// instant (EPERM / EBUSY / EACCES) : on réessaie quelques fois avant d'abandonner.
function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(error.code)
      if (!transient || attempt >= RENAME_ATTEMPTS) throw error
      sleepSync(RENAME_DELAY_MS * attempt)
    }
  }
}

function tryRead(path) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf-8')) }
  } catch (error) {
    return { ok: false, missing: error.code === 'ENOENT', corrupt: error instanceof SyntaxError }
  }
}

function resolveFallback(fallback) {
  return typeof fallback === 'function' ? fallback() : fallback
}

// Contenu du fichier JSON, sinon de sa sauvegarde, sinon "fallback" (valeur ou
// fonction qui la produit, pour ne pas partager un même objet mutable).
export function readJsonFile(path, fallback = null) {
  const main = tryRead(path)
  if (main.ok) return main.value
  const backup = tryRead(path + '.bak')
  if (backup.ok) return backup.value
  if (main.corrupt) {
    try {
      renameWithRetry(path, `${path}.corrupt-${Date.now()}`)
    } catch {
      // Impossible de le mettre de côté : on repart quand même des valeurs par défaut.
    }
  }
  return resolveFallback(fallback)
}

// Écrit "data" en JSON de façon atomique (voir plus haut). space : indentation.
export function writeJsonFile(path, data, space) {
  const text = JSON.stringify(data, null, space)
  const tmp = path + '.tmp'
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, text, null, 'utf-8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    if (existsSync(path)) renameWithRetry(path, path + '.bak')
    renameWithRetry(tmp, path)
  } catch {
    // Renommage impossible (fichier verrouillé durablement) : écriture directe, la
    // sauvegarde .bak reste là en cas de problème.
    writeFileSync(path, text, 'utf-8')
  }
}
