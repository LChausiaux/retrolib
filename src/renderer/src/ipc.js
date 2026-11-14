import { toRaw } from 'vue'

// Les erreurs levées dans le processus principal arrivent préfixées par Electron
// ("Error invoking remote method 'x': Error: ...") : on ne garde que le message utile.
export function ipcErrorMessage(err) {
  const message = err?.message || String(err)
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

// Les objets réactifs de Vue (Proxy) ne peuvent pas traverser l'IPC (structured
// clone : "An object could not be cloned") : on envoie une copie plate des seuls
// champs utiles. toRaw ne suffit pas toujours (tableaux réactifs imbriqués, comme
// discPaths des jeux multi-disques).
export function plainGame(game, fields) {
  const plain = {}
  for (const field of fields) {
    const value = toRaw(game[field])
    plain[field] = Array.isArray(value) ? [...value] : (value ?? null)
  }
  return plain
}
