import { ref } from 'vue'

// Bibliothèque : jeux scannés, état des émulateurs et catalogue des plateformes, tels
// que renvoyés par le processus principal (main/library.js).
export function useLibrary() {
  const configured = ref(true)
  const games = ref([])
  const loading = ref(true)
  const error = ref(null)
  const installRoot = ref(null)
  const platformsWithChoice = ref([])
  const platformCatalog = ref({ labels: {}, assignable: [] })
  const emulatorStatus = ref([])

  // Versions d'émulateurs déjà lues (par chemin d'exe) : réappliquées immédiatement à
  // chaque rechargement de la bibliothèque (après chaque réglage modifié) pour ne pas
  // réafficher "lecture de la version…" sur des versions déjà connues.
  let knownVersions = {}
  // Numéro du dernier chargement : ignore la réponse d'une lecture de versions lancée
  // par un rechargement antérieur, arrivée après un rechargement plus récent.
  let versionsRequestId = 0

  // Applique des versions connues (chemin d'exe -> version) à l'état des émulateurs.
  // Un chemin absent de "versions" garde son état ; s'il y figure, versionPending passe
  // à false, même si la version vaut null (exe sans version lisible). Avec
  // "finalize", plus rien ne reste en attente (la lecture de fond est terminée).
  function withVersions(status, versions, finalize) {
    const apply = (candidate, path) => {
      if (!path) return candidate
      if (path in versions) {
        return { ...candidate, installedVersion: versions[path], versionPending: false }
      }
      return finalize ? { ...candidate, versionPending: false } : candidate
    }
    return status.map((entry) => ({
      ...apply(entry, entry.activePath),
      detected: entry.detected.map((candidate) => apply(candidate, candidate.path))
    }))
  }

  async function loadEmulatorVersions() {
    const requestId = ++versionsRequestId
    const paths = new Set()
    for (const entry of emulatorStatus.value) {
      if (entry.activePath) paths.add(entry.activePath)
      for (const candidate of entry.detected) paths.add(candidate.path)
    }
    if (paths.size === 0) return
    let versions = {}
    try {
      versions = await window.api.getEmulatorVersions([...paths])
    } catch {
      // Laisse les versions inconnues plutôt que de bloquer la page Émulateurs.
    }
    if (requestId !== versionsRequestId) return
    knownVersions = { ...knownVersions, ...versions }
    emulatorStatus.value = withVersions(emulatorStatus.value, versions, true)
  }

  // Le message "Chargement de la bibliothèque…" (qui remplace toute la page) n'est
  // affiché qu'au premier chargement : les rechargements suivants (réglage modifié,
  // nouveau jeu détecté...) se font en place, sans refermer la page affichée.
  // Renvoie les jeux apparus depuis le chargement précédent.
  async function loadLibrary({ silent = games.value.length > 0 } = {}) {
    if (!silent) loading.value = true
    error.value = null
    const previousIds = new Set(games.value.map((game) => game.id))
    const hadGames = games.value.length > 0
    try {
      const result = await window.api.getLibrary()
      configured.value = result.configured
      games.value = result.games
      installRoot.value = result.installRoot
      platformsWithChoice.value = result.platformsWithChoice || []
      emulatorStatus.value = withVersions(result.emulatorStatus || [], knownVersions, false)
      platformCatalog.value = result.platformCatalog || { labels: {}, assignable: [] }
      if (result.error) error.value = result.error
    } catch (err) {
      error.value = err?.message || String(err)
    } finally {
      loading.value = false
    }
    // Pas d'await : la bibliothèque est déjà affichée, les versions (lecture des exe,
    // parfois lente) arrivent ensuite sur la page Émulateurs.
    loadEmulatorVersions()
    return hadGames ? games.value.filter((game) => !previousIds.has(game.id)) : []
  }

  async function chooseFolder() {
    const path = await window.api.chooseRomStationFolder()
    if (path) await loadLibrary({ silent: false })
  }

  // Même tri que côté main (voir library.js) : favoris en tête, puis ordre alphabétique.
  function sortGames(list) {
    return list.sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title, 'fr')
    )
  }

  // Modification locale d'un jeu (affichage optimiste, sans nouveau scan).
  function patchGame(gameId, changes) {
    games.value = sortGames(
      games.value.map((game) => (game.id === gameId ? { ...game, ...changes } : game))
    )
  }

  return {
    configured,
    games,
    loading,
    error,
    installRoot,
    platformsWithChoice,
    platformCatalog,
    emulatorStatus,
    loadLibrary,
    chooseFolder,
    patchGame
  }
}
