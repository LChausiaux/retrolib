import { ref, computed, onMounted, onUnmounted } from 'vue'
import { aggregateByGame } from '../stats-utils'

// Stats (voir main/stats.js) : sessions de jeu, sessions en cours, utilisation de
// l'appli. games : ref des jeux de la bibliothèque, complétés ici par leur suivi.
export function useStats(games) {
  const stats = ref({ app: {}, sessions: [], active: [] })
  // Horloge pour le temps "en jeu" des sessions en cours : avancée toutes les 30 s
  // seulement tant qu'un émulateur tourne.
  const now = ref(Date.now())

  async function loadStats() {
    try {
      stats.value = await window.api.getStats()
    } catch {
      // Les stats ne doivent jamais bloquer la bibliothèque.
    }
  }

  const statsByGame = computed(() => aggregateByGame(stats.value.sessions))

  // Jeux de la bibliothèque complétés par leur suivi : temps de jeu et sessions
  // (calculés depuis les sessions) et session en cours.
  const enrichedGames = computed(() => {
    const activeById = new Map(stats.value.active.map((session) => [session.gameId, session]))
    return games.value.map((game) => {
      const played = statsByGame.value[game.id]
      const active = activeById.get(game.id)
      return {
        ...game,
        playtime: played?.playtime || 0,
        sessionCount: played?.sessionCount || 0,
        firstPlayed: played?.firstPlayed || active?.start || null,
        lastPlayed: active ? now.value : played?.lastPlayed || null,
        longestSession: played?.longestSession || 0,
        playingSince: active?.start || null
      }
    })
  })

  let unsubscribe = null
  let clockTimer = null

  onMounted(() => {
    loadStats()
    // Une session de jeu commence ou se termine (voir main/index.js).
    unsubscribe = window.api.onStatsChanged(() => {
      now.value = Date.now()
      loadStats()
    })
    clockTimer = setInterval(() => {
      if (stats.value.active.length) now.value = Date.now()
    }, 30 * 1000)
  })

  onUnmounted(() => {
    unsubscribe?.()
    clearInterval(clockTimer)
  })

  return { stats, now, loadStats, enrichedGames }
}
