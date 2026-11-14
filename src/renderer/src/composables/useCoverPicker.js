import { ref, computed } from 'vue'

// Fenêtre "Choisir une jaquette" de la page du jeu (voir CoverPickerModal.vue et
// main/cover-sources.js), qui propose aussi un fichier local. Si le jeu n'a pas de
// dossier dédié (rom isolée, ex. la plupart des jeux Switch), le processus principal
// lui en crée un et y déplace la rom : le chemin — donc l'id du jeu, dérivé du chemin
// (scanner-games.js) — change alors. On retrouve le jeu après rechargement par son
// nouveau folderPath pour garder la page ouverte.
export function useCoverPicker({
  games,
  enrichedGames,
  selectedGameId,
  selectedGame,
  loadLibrary
}) {
  const coverPickerOpen = ref(false)
  const coverFace = ref('front') // 'front' (jaquette) | 'back' (dos de la boîte)
  const coverApplyingUrl = ref(null)
  const coverApplyError = ref(null)
  // Passé à true dès que l'utilisateur utilise "Jeu suivant sans jaquette" : appliquer
  // une jaquette enchaîne alors directement sur le jeu suivant au lieu de fermer.
  const coverChainMode = ref(false)

  const gamesMissingCover = computed(() =>
    enrichedGames.value.filter((game) => !game.coverUrl && game.platform)
  )

  const nextGameMissingCover = computed(() => {
    const current = selectedGameId.value
    const list = enrichedGames.value
    const start = list.findIndex((game) => game.id === current)
    for (let offset = 1; offset <= list.length; offset++) {
      const game = list[(start + offset) % list.length]
      if (game.id !== current && !game.coverUrl && game.platform) return game
    }
    return null
  })

  function openCoverPicker(_game, face = 'front') {
    coverApplyError.value = null
    coverChainMode.value = false
    coverFace.value = face === 'back' ? 'back' : 'front'
    coverPickerOpen.value = true
  }

  function switchCoverFace(face) {
    coverApplyError.value = null
    coverChainMode.value = false
    coverFace.value = face
  }

  function closeCoverPicker() {
    coverPickerOpen.value = false
    coverApplyingUrl.value = null
  }

  function goToNextGameMissingCover() {
    const next = nextGameMissingCover.value
    if (!next) return closeCoverPicker()
    coverChainMode.value = true
    coverApplyError.value = null
    selectedGameId.value = next.id
  }

  async function followMovedGame(game, folderPath) {
    await loadLibrary()
    if (folderPath !== game.folderPath) {
      const moved = games.value.find((g) => g.folderPath === folderPath)
      if (moved) selectedGameId.value = moved.id
    }
  }

  async function handleApplyRemoteCover(candidate) {
    const game = selectedGame.value
    if (!game || coverApplyingUrl.value) return
    coverApplyingUrl.value = candidate.url
    coverApplyError.value = null
    try {
      const { folderPath } = await window.api.applyRemoteCover(
        game.folderPath,
        game.romPath,
        candidate.url,
        coverFace.value
      )
      await followMovedGame(game, folderPath)
      if (coverFace.value === 'front' && coverChainMode.value && nextGameMissingCover.value) {
        goToNextGameMissingCover()
      } else {
        closeCoverPicker()
      }
    } catch (err) {
      coverApplyError.value = `Impossible d’appliquer cette jaquette : ${err.message || err}`
    } finally {
      coverApplyingUrl.value = null
    }
  }

  async function handleChooseCoverFile() {
    const game = selectedGame.value
    if (!game) return
    const sourcePath = await window.api.chooseCoverImage()
    if (!sourcePath) return
    const { folderPath } = await window.api.setGameCover(
      game.folderPath,
      game.romPath,
      sourcePath,
      coverFace.value
    )
    closeCoverPicker()
    await followMovedGame(game, folderPath)
  }

  return {
    coverPickerOpen,
    coverFace,
    coverApplyingUrl,
    coverApplyError,
    gamesMissingCover,
    nextGameMissingCover,
    openCoverPicker,
    switchCoverFace,
    closeCoverPicker,
    goToNextGameMissingCover,
    handleApplyRemoteCover,
    handleChooseCoverFile
  }
}
