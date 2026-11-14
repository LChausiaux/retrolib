<script setup>
import { computed } from 'vue'
import PlatformIcon from './PlatformIcon.vue'
import ActivityHeatmap from './ActivityHeatmap.vue'
import PlayHabits from './PlayHabits.vue'
import {
  formatDuration,
  formatDurationShort,
  formatRelative,
  formatDate,
  startOfDay,
  computeStreaks,
  withLiveSessions,
  sumDuration,
  longestSession,
  biggestDay
} from '../stats-utils'

// Page "Mes stats" : récapitulatif de l'utilisation de RetroLib et des jeux. Tout est
// calculé ici depuis la liste brute des sessions (voir main/stats.js). Le filtre de
// période (sidebar) s'applique au temps de jeu, aux classements, aux habitudes et aux
// dernières parties ; le calendrier (6 mois), les séries et l'utilisation de l'appli
// sont indépendants de la période (c'est indiqué sur chaque bloc).
// La fiche du jeu reprend ce modèle en réduit (voir GameStats.vue).
const props = defineProps({
  games: { type: Array, required: true }, // bibliothèque enrichie (voir App.vue)
  stats: { type: Object, required: true },
  period: { type: String, default: 'all' },
  now: { type: Number, required: true },
  platformCatalog: { type: Object, default: () => ({ labels: {} }) }
})

const emit = defineEmits(['open-game'])

const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_DAYS = { year: 365, month: 30, week: 7 }

const gamesById = computed(() => new Map(props.games.map((game) => [game.id, game])))

const allSessions = computed(() =>
  withLiveSessions(props.stats.sessions, props.stats.active, props.now)
)

const periodSessions = computed(() => {
  const days = PERIOD_DAYS[props.period]
  if (!days) return allSessions.value
  const since = startOfDay(props.now) - (days - 1) * DAY_MS
  return allSessions.value.filter((session) => session.start >= since)
})

const periodLabel = computed(
  () =>
    ({
      all: 'depuis toujours',
      year: 'sur les 12 derniers mois',
      month: 'sur les 30 derniers jours',
      week: 'sur les 7 derniers jours'
    })[props.period]
)

const totalPlaytime = computed(() => sumDuration(periodSessions.value))

const distinctGames = computed(() => new Set(periodSessions.value.map((s) => s.gameId)).size)

const averageSession = computed(() =>
  periodSessions.value.length ? totalPlaytime.value / periodSessions.value.length : 0
)

function gameTitle(gameId, fallback) {
  return gamesById.value.get(gameId)?.title || fallback || 'Jeu supprimé'
}

function platformLabel(platform) {
  return props.platformCatalog.labels?.[platform] || platform || 'Inconnue'
}

// --- Top jeux de la période ---
const topGames = computed(() => {
  const byGame = new Map()
  for (const session of periodSessions.value) {
    const entry = byGame.get(session.gameId) || {
      gameId: session.gameId,
      title: gameTitle(session.gameId, session.title),
      coverUrl: gamesById.value.get(session.gameId)?.coverUrl || null,
      playtime: 0
    }
    entry.playtime += session.duration
    byGame.set(session.gameId, entry)
  }
  const list = [...byGame.values()].sort((a, b) => b.playtime - a.playtime).slice(0, 8)
  const max = list[0]?.playtime || 1
  return list.map((entry) => ({ ...entry, share: (entry.playtime / max) * 100 }))
})

// --- Temps par plateforme ---
const byPlatform = computed(() => {
  const totals = new Map()
  for (const session of periodSessions.value) {
    const platform = gamesById.value.get(session.gameId)?.platform || session.platform || null
    totals.set(platform, (totals.get(platform) || 0) + session.duration)
  }
  const list = [...totals.entries()]
    .map(([platform, playtime]) => ({ platform, playtime }))
    .sort((a, b) => b.playtime - a.playtime)
  const max = list[0]?.playtime || 1
  return list.map((entry) => ({ ...entry, share: (entry.playtime / max) * 100 }))
})

const longest = computed(() => longestSession(periodSessions.value))
const bestDay = computed(() => biggestDay(periodSessions.value))

const recentSessions = computed(() =>
  [...periodSessions.value].sort((a, b) => b.start - a.start).slice(0, 6)
)

const streaks = computed(() => computeStreaks(allSessions.value, props.now))

const totalPlaytimeEver = computed(() => sumDuration(allSessions.value))

function canOpen(gameId) {
  return gamesById.value.has(gameId)
}
</script>

<template>
  <div class="stats-page stats-ui">
    <!-- Tuiles principales (période choisie) -->
    <section class="hero">
      <div class="hero-tile main">
        <span class="hero-value">{{ formatDuration(totalPlaytime) }}</span>
        <span class="hero-label">de jeu {{ periodLabel }}</span>
      </div>
      <div class="hero-tile">
        <span class="hero-value">{{ periodSessions.length }}</span>
        <span class="hero-label">sessions</span>
      </div>
      <div class="hero-tile">
        <span class="hero-value">{{ distinctGames }}</span>
        <span class="hero-label">jeux lancés</span>
      </div>
      <div class="hero-tile">
        <span class="hero-value">{{ averageSession ? formatDuration(averageSession) : '—' }}</span>
        <span class="hero-label">par session en moyenne</span>
      </div>
      <div class="hero-tile">
        <span class="hero-value">🔥 {{ streaks.current }} j</span>
        <span class="hero-label">série en cours · record {{ streaks.best }} j</span>
      </div>
    </section>

    <p v-if="!allSessions.length" class="empty">
      🎮 Aucune partie enregistrée pour l'instant. Lance un jeu depuis la bibliothèque : le temps de
      jeu est compté automatiquement jusqu'à la fermeture de l'émulateur.
    </p>
    <p v-else-if="!periodSessions.length" class="empty">
      Pas de partie {{ periodLabel }}. Change de période dans la barre de gauche.
    </p>

    <div class="cards">
      <section class="card wide">
        <header class="card-header">
          <h2>Activité</h2>
          <span class="card-sub">6 derniers mois</span>
        </header>
        <ActivityHeatmap :sessions="allSessions" :now="now" :weeks="26" />
      </section>

      <section class="card">
        <header class="card-header">
          <h2>Jeux les plus joués</h2>
          <span class="card-sub">{{ periodLabel }}</span>
        </header>
        <p v-if="!topGames.length" class="card-empty">Rien pour cette période.</p>
        <ol class="ranking">
          <li
            v-for="(entry, index) in topGames"
            :key="entry.gameId"
            class="rank-row"
            :class="{ clickable: canOpen(entry.gameId) }"
            @click="canOpen(entry.gameId) && emit('open-game', entry.gameId)"
          >
            <span class="rank-medal">{{ ['🥇', '🥈', '🥉'][index] || index + 1 }}</span>
            <img v-if="entry.coverUrl" class="rank-cover" :src="entry.coverUrl" alt="" />
            <span v-else class="rank-cover placeholder">{{ entry.title.slice(0, 1) }}</span>
            <div class="rank-body">
              <div class="rank-line">
                <span class="rank-title">{{ entry.title }}</span>
                <span class="rank-value">{{ formatDurationShort(entry.playtime) }}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" :style="{ width: entry.share + '%' }"></div>
              </div>
            </div>
          </li>
        </ol>
      </section>

      <section class="card">
        <header class="card-header">
          <h2>Par plateforme</h2>
          <span class="card-sub">{{ periodLabel }}</span>
        </header>
        <p v-if="!byPlatform.length" class="card-empty">Rien pour cette période.</p>
        <ul class="ranking">
          <li v-for="entry in byPlatform" :key="entry.platform || 'unknown'" class="rank-row">
            <span class="platform-icon">
              <PlatformIcon v-if="entry.platform" :platform="entry.platform" :size="20" />
              <span v-else>?</span>
            </span>
            <div class="rank-body">
              <div class="rank-line">
                <span class="rank-title">{{ platformLabel(entry.platform) }}</span>
                <span class="rank-value">{{ formatDurationShort(entry.playtime) }}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" :style="{ width: entry.share + '%' }"></div>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section class="card">
        <header class="card-header">
          <h2>Mes habitudes</h2>
          <span class="card-sub">{{ periodLabel }}</span>
        </header>
        <PlayHabits :sessions="periodSessions" />
        <ul class="records">
          <li v-if="longest">
            <span>🏃</span>
            <span>
              Plus longue session :
              <strong>{{ formatDuration(longest.duration) }}</strong> sur
              {{ gameTitle(longest.gameId, longest.title) }}
            </span>
          </li>
          <li v-if="bestDay">
            <span>📆</span>
            <span>
              Plus grosse journée : <strong>{{ formatDuration(bestDay.playtime) }}</strong> le
              {{ formatDate(bestDay.day) }}
            </span>
          </li>
        </ul>
      </section>

      <section class="card">
        <header class="card-header">
          <h2>Dernières parties</h2>
        </header>
        <p v-if="!recentSessions.length" class="card-empty">Rien pour cette période.</p>
        <ul class="sessions">
          <li
            v-for="session in recentSessions"
            :key="session.gameId + session.start"
            :class="{ clickable: canOpen(session.gameId) }"
            @click="canOpen(session.gameId) && emit('open-game', session.gameId)"
          >
            <span class="session-title">
              <span v-if="session.live" class="live-dot">●</span>
              {{ gameTitle(session.gameId, session.title) }}
            </span>
            <span class="session-meta">
              {{ session.live ? 'en cours' : formatRelative(session.start, now) }} ·
              {{ formatDuration(session.duration) }}
            </span>
          </li>
        </ul>
      </section>

      <section class="card wide app-usage">
        <span>🕹️</span>
        <span>
          RetroLib ouvert <strong>{{ stats.app.openCount || 0 }} fois</strong>
          <template v-if="stats.app.firstOpen">
            depuis le {{ formatDate(stats.app.firstOpen) }}</template
          >
          · <strong>{{ formatDuration(stats.app.totalOpenSeconds) }}</strong> passées dans l'appli ·
          <strong>{{ formatDuration(totalPlaytimeEver) }}</strong> de jeu au total
        </span>
      </section>
    </div>
  </div>
</template>

<style scoped>
.stats-page {
  padding: 24px 28px 40px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Classements (jeux, plateformes) */
.ranking {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rank-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px;
  border-radius: 8px;
}
.rank-medal {
  width: 22px;
  text-align: center;
  font-size: 0.85rem;
  opacity: 0.85;
  flex-shrink: 0;
}
.rank-cover {
  width: 30px;
  height: 30px;
  border-radius: 5px;
  object-fit: cover;
  flex-shrink: 0;
}
.rank-cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  font-size: 0.8rem;
  opacity: 0.6;
}
.platform-icon {
  width: 22px;
  display: flex;
  justify-content: center;
  flex-shrink: 0;
}
.rank-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rank-line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.82rem;
}
.rank-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-value {
  opacity: 0.7;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.bar-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 999px;
  background: #7d8cff;
}

.card.app-usage {
  flex-direction: row;
  align-items: center;
  gap: 12px;
  font-size: 0.82rem;
}
</style>
