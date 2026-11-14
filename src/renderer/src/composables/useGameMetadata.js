import { ref, computed, onMounted, onUnmounted } from 'vue'
import { genreOptions } from '../genres'

// Fiches de jeu issues de la base LaunchBox (voir main/launchbox-db.js) : genres et
// nombre de joueurs de toute la bibliothèque (filtre par genre), état de la base
// (téléchargement en cours, disponible) et compteur de version qui invite la fiche
// affichée à se recharger quand la base devient disponible ou qu'une correspondance
// est corrigée à la main.
export function useGameMetadata(games) {
  const byGame = ref({})
  const launchboxStatus = ref({ available: false, building: false, phase: null, fraction: null })
  const detailsVersion = ref(0)

  let requestId = 0
  async function loadLibraryMetadata() {
    const id = ++requestId
    const summary = games.value.map((game) => ({
      id: game.id,
      title: game.title,
      platform: game.platform
    }))
    try {
      const result = await window.api.getLibraryMetadata(summary)
      if (id === requestId) byGame.value = result.byGame || {}
    } catch {
      // Fiches indisponibles : la bibliothèque fonctionne sans.
    }
  }

  // Après une correction manuelle de la correspondance (fiche du jeu).
  function refreshDetails() {
    detailsVersion.value++
    loadLibraryMetadata()
  }

  const genres = computed(() => genreOptions(games.value, byGame.value))

  let unsubscribe = null
  onMounted(async () => {
    unsubscribe = window.api.onLaunchboxState((state) => {
      const becameReady =
        state.available &&
        !state.building &&
        (launchboxStatus.value.building || !launchboxStatus.value.available)
      launchboxStatus.value = state
      if (becameReady) refreshDetails()
    })
    try {
      launchboxStatus.value = await window.api.getLaunchboxStatus()
    } catch {
      // État inconnu : la fiche du jeu le redemandera.
    }
  })
  onUnmounted(() => unsubscribe?.())

  return { byGame, genres, launchboxStatus, detailsVersion, loadLibraryMetadata, refreshDetails }
}
