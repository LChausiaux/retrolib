import { ref, computed, onMounted, onUnmounted } from 'vue'

// Mise à jour automatique de RetroLib (voir main/updater.js) : état courant, recherche
// manuelle et redémarrage pour installer une version déjà téléchargée.
export function useUpdater() {
  const update = ref({ status: 'idle' })

  const statusText = computed(() => {
    const u = update.value
    switch (u.status) {
      case 'disabled':
        return 'Mises à jour automatiques désactivées en développement.'
      case 'checking':
        return 'Recherche d’une mise à jour…'
      case 'up-to-date':
        return 'RetroLib est à jour.'
      case 'downloading':
        return `Téléchargement de la version ${u.version}… ${Math.round(u.percent || 0)} %`
      case 'downloaded':
        return `La version ${u.version} est prête : elle sera installée à la fermeture de RetroLib.`
      case 'error':
        return `Recherche impossible : ${u.error}`
      default:
        return 'Les mises à jour sont recherchées au démarrage puis toutes les 6 heures.'
    }
  })

  async function checkForUpdates() {
    try {
      update.value = await window.api.checkForUpdates()
    } catch {
      // L'état d'erreur arrive aussi par l'événement update:state.
    }
  }

  function installUpdate() {
    window.api.installUpdate()
  }

  let unsubscribe = null
  onMounted(async () => {
    unsubscribe = window.api.onUpdateState((state) => (update.value = state))
    try {
      update.value = await window.api.getUpdateState()
    } catch {
      // État inconnu : affichage par défaut.
    }
  })
  onUnmounted(() => unsubscribe?.())

  return { update, statusText, checkForUpdates, installUpdate }
}
