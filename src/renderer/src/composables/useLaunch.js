import { ref, onMounted, onUnmounted } from 'vue'
import { ipcErrorMessage, plainGame } from '../ipc'

const LAUNCH_FIELDS = [
  'id',
  'title',
  'platform',
  'romPath',
  'discPaths',
  'emulatorPath',
  'emulatorLaunchArgs'
]

// Lancement des jeux : choix du disque, progression de la décompression, erreurs.
// launchError est partagé avec le reste de l'appli (bandeau d'erreur unique).
export function useLaunch(launchError) {
  const launchingGameId = ref(null)
  const discSelectGame = ref(null) // jeu en attente d'un choix de disque avant lancement
  const launchProgress = ref(null) // { gameId, discIndex, discCount, fraction } pendant une décompression

  async function performLaunch(game, discIndex) {
    launchingGameId.value = game.id
    launchError.value = null
    launchProgress.value = null
    try {
      await window.api.launchGame(plainGame(game, LAUNCH_FIELDS), discIndex)
    } catch (err) {
      launchError.value = ipcErrorMessage(err)
    } finally {
      launchingGameId.value = null
      launchProgress.value = null
    }
  }

  function handleLaunch(game, discIndex) {
    // Disque déjà choisi (fiche du jeu) : lancement direct.
    if (Number.isInteger(discIndex)) {
      performLaunch(game, discIndex)
      return
    }
    // Jeu multi-disque : on demande d'abord quel disque lancer plutôt que de démarrer
    // silencieusement sur le premier (voir DiscSelectModal).
    if (game.discCount > 1) {
      discSelectGame.value = game
      return
    }
    performLaunch(game, 0)
  }

  function handleDiscChoice(discIndex) {
    const game = discSelectGame.value
    discSelectGame.value = null
    performLaunch(game, discIndex)
  }

  function cancelDiscSelect() {
    discSelectGame.value = null
  }

  let unsubscribe = null
  onMounted(() => {
    unsubscribe = window.api.onLaunchProgress((payload) => {
      launchProgress.value = payload
    })
  })
  onUnmounted(() => unsubscribe?.())

  return {
    launchingGameId,
    discSelectGame,
    launchProgress,
    handleLaunch,
    handleDiscChoice,
    cancelDiscSelect
  }
}
