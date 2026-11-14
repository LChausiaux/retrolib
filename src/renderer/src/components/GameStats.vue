<script setup>
import { computed } from 'vue'
import ActivityHeatmap from './ActivityHeatmap.vue'
import PlayHabits from './PlayHabits.vue'
import {
  formatDuration,
  formatRelative,
  formatDate,
  withLiveSessions,
  sumDuration,
  longestSession,
  biggestDay
} from '../stats-utils'

// Stats du jeu dans sa fiche : même modèle que la page Stats (StatsPage.vue), en
// réduit et limité à ce jeu — tuiles principales, calendrier sur 4 mois, habitudes et
// records, dernières parties.
const props = defineProps({
  game: { type: Object, required: true },
  sessions: { type: Array, required: true }, // sessions terminées de CE jeu
  now: { type: Number, required: true }
})

const allSessions = computed(() =>
  withLiveSessions(
    props.sessions,
    props.game.playingSince ? [{ gameId: props.game.id, start: props.game.playingSince }] : [],
    props.now
  )
)

const totalPlaytime = computed(() => sumDuration(allSessions.value))

const averageSession = computed(() =>
  allSessions.value.length ? totalPlaytime.value / allSessions.value.length : 0
)

const lastPlayed = computed(() => {
  if (props.game.playingSince) return 'maintenant'
  const last = Math.max(0, ...props.sessions.map((s) => s.end))
  return last ? formatRelative(last, props.now) : '—'
})

const firstPlayed = computed(() =>
  allSessions.value.length ? Math.min(...allSessions.value.map((s) => s.start)) : null
)

const longest = computed(() => longestSession(allSessions.value))
const bestDay = computed(() => biggestDay(allSessions.value))

const recentSessions = computed(() =>
  [...allSessions.value].sort((a, b) => b.start - a.start).slice(0, 5)
)

function sessionDate(session) {
  return new Date(session.start).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })
}
</script>

<template>
  <section class="game-stats stats-ui">
    <header class="game-stats-header">
      <h2>Statistiques</h2>
      <span v-if="game.playingSince" class="playing-now">
        ● En jeu depuis {{ formatDuration((now - game.playingSince) / 1000) }}
      </span>
    </header>

    <p v-if="!allSessions.length" class="empty">
      🎮 Pas encore joué : le temps de jeu sera compté automatiquement au premier lancement, jusqu'à
      la fermeture de l'émulateur.
    </p>

    <template v-else>
      <div class="hero compact">
        <div class="hero-tile main">
          <span class="hero-value">{{ formatDuration(totalPlaytime) }}</span>
          <span class="hero-label">de jeu au total</span>
        </div>
        <div class="hero-tile">
          <span class="hero-value">{{ allSessions.length }}</span>
          <span class="hero-label">session{{ allSessions.length > 1 ? 's' : '' }}</span>
        </div>
        <div class="hero-tile">
          <span class="hero-value">{{ formatDuration(averageSession) }}</span>
          <span class="hero-label">par session en moyenne</span>
        </div>
        <div class="hero-tile">
          <span class="hero-value">{{ lastPlayed }}</span>
          <span class="hero-label">dernière partie</span>
        </div>
      </div>

      <div class="cards">
        <section class="card wide">
          <header class="card-header">
            <h2>Activité</h2>
            <span class="card-sub">4 derniers mois</span>
          </header>
          <ActivityHeatmap :sessions="allSessions" :now="now" :weeks="17" />
        </section>

        <section class="card">
          <header class="card-header">
            <h2>Habitudes</h2>
          </header>
          <PlayHabits :sessions="allSessions" subject="Tu y joues" />
          <ul class="records">
            <li v-if="longest">
              <span>🏃</span>
              <span>
                Plus longue session : <strong>{{ formatDuration(longest.duration) }}</strong>
              </span>
            </li>
            <li v-if="bestDay">
              <span>📆</span>
              <span>
                Plus grosse journée : <strong>{{ formatDuration(bestDay.playtime) }}</strong> le
                {{ formatDate(bestDay.day) }}
              </span>
            </li>
            <li v-if="firstPlayed">
              <span>✨</span>
              <span>Première partie le {{ formatDate(firstPlayed) }}</span>
            </li>
          </ul>
        </section>

        <section class="card">
          <header class="card-header">
            <h2>Dernières parties</h2>
          </header>
          <ul class="sessions">
            <li v-for="session in recentSessions" :key="session.start">
              <span class="session-title">
                <span v-if="session.live" class="live-dot">●</span>
                {{ session.live ? 'En cours' : sessionDate(session) }}
              </span>
              <span class="session-meta">{{ formatDuration(session.duration) }}</span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.game-stats {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.game-stats-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.game-stats-header h2 {
  margin: 0;
  font-size: 1.05rem;
}
.playing-now {
  font-size: 0.75rem;
  color: #8fdcaa;
  animation: pulse 1.8s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.55;
  }
}
.hero.compact {
  grid-template-columns: 1.4fr repeat(3, 1fr);
}
.hero.compact .hero-tile {
  padding: 12px 14px;
}
.hero.compact .hero-value {
  font-size: 1.2rem;
}
.hero.compact .hero-tile.main .hero-value {
  font-size: 1.5rem;
}
.game-stats .cards {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
</style>
