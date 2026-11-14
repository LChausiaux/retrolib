<script setup>
import { ref, computed } from 'vue'
import PlatformIcon from './PlatformIcon.vue'
import AppIcon from './AppIcon.vue'
import GameBox3D from './GameBox3D.vue'
import { orderByFamily } from '../platform-families'
import { formatDurationShort, formatRelative } from '../stats-utils'

// Bibliothèque V2 : bandeau "Reprendre", section Favoris, puis tous les jeux, en
// trois vues au choix — grille de jaquettes, liste détaillée, étagère de boîtes 3D.
const props = defineProps({
  games: { type: Array, required: true },
  view: { type: String, default: 'grid' }, // 'grid' | 'list' | 'shelf'
  sort: { type: String, default: 'title' }, // 'title' | 'recent' | 'playtime' | 'year'
  title: { type: String, default: 'Tous les jeux' },
  // Faux pour une vue déjà filtrée sur les favoris, ou triée autrement par nature
  // ("Récemment joués") : la section Favoris y serait redondante.
  groupFavorites: { type: Boolean, default: true },
  showResume: { type: Boolean, default: true },
  // Vue toutes plateformes : plateforme affichée sur chaque jeu, étagères par console.
  mixedPlatforms: { type: Boolean, default: false },
  platformCatalog: { type: Object, default: () => ({ labels: {} }) },
  launchingGameId: { type: String, default: null },
  launchProgress: { type: Object, default: null },
  now: { type: Number, default: () => Date.now() }
})

const emit = defineEmits(['select', 'launch', 'toggle-favorite'])

function platformLabel(platform) {
  return platform ? props.platformCatalog.labels?.[platform] || platform : 'Plateforme inconnue'
}

function compareTitle(a, b) {
  return a.title.localeCompare(b.title, 'fr')
}

const SORTERS = {
  title: compareTitle,
  recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || compareTitle(a, b),
  playtime: (a, b) => (b.playtime || 0) - (a.playtime || 0) || compareTitle(a, b),
  year: (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || compareTitle(a, b)
}

const sortedGames = computed(() => [...props.games].sort(SORTERS[props.sort] || compareTitle))

const favorites = computed(() => sortedGames.value.filter((game) => game.favorite))
const showFavorites = computed(
  () =>
    props.groupFavorites &&
    favorites.value.length > 0 &&
    favorites.value.length < props.games.length
)

// Jeu à reprendre : celui en cours, sinon le dernier joué de la liste affichée.
const resumeGame = computed(() => {
  if (!props.showResume) return null
  let best = null
  for (const game of props.games) {
    if (game.playingSince) return game
    if (game.lastPlayed && (!best || game.lastPlayed > best.lastPlayed)) best = game
  }
  return best
})

// Rubrique « Reprendre » : les jeux joués juste avant celui mis en avant, du plus
// récent au plus ancien, pour relancer l'un d'eux sans le chercher.
const RECENT_COUNT = 4
const recentGames = computed(() => {
  if (!resumeGame.value) return []
  return props.games
    .filter((game) => game.lastPlayed && game.id !== resumeGame.value.id)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, RECENT_COUNT)
})

// Étagères : une par console quand la vue mélange les plateformes (triée par titre),
// sinon une seule.
const shelves = computed(() => {
  if (!props.mixedPlatforms || props.sort !== 'title') {
    return [{ key: 'all', name: null, games: sortedGames.value }]
  }
  const byPlatform = new Map()
  for (const game of sortedGames.value) {
    const key = game.platform || ''
    if (!byPlatform.has(key)) byPlatform.set(key, [])
    byPlatform.get(key).push(game)
  }
  const groups = [...byPlatform.entries()].map(([platform, games]) => ({
    key: platform || '__unknown__',
    platform,
    name: platformLabel(platform),
    games
  }))
  return orderByFamily(groups)
})

function metaFor(game) {
  const parts = []
  if (props.mixedPlatforms) parts.push(platformLabel(game.platform))
  if (game.discCount > 1) parts.push(`${game.discCount} disques`)
  else if (game.year) parts.push(game.year)
  return parts.join(' · ')
}

function progressFor(game) {
  const p = props.launchProgress
  return p && p.gameId === game.id && p.fraction < 1 ? p : null
}

function progressText(p) {
  const disc = p.discCount > 1 ? ` (disque ${p.discIndex + 1}/${p.discCount})` : ''
  return `Décompression${disc}… ${Math.round(p.fraction * 100)} %`
}

// Boîte de l'étagère qui a le focus clavier / manette : elle pivote légèrement.
const focusedBoxId = ref(null)
</script>

<template>
  <div class="library">
    <!-- Reprendre -->
    <section v-if="resumeGame" class="resume" aria-label="Reprendre">
      <div class="resume-cover" aria-hidden="true">
        <img v-if="resumeGame.coverUrl" :src="resumeGame.coverUrl" alt="" />
      </div>
      <div class="resume-info">
        <div class="status">
          <template v-if="resumeGame.playingSince">
            <span class="dot live"></span>En cours
          </template>
          <template v-else>
            <span class="dot"></span>Dernière session
            {{ formatRelative(resumeGame.lastPlayed, now) }}
          </template>
        </div>
        <h2>{{ resumeGame.title }}</h2>
        <div class="resume-meta">
          {{ platformLabel(resumeGame.platform) }}
          <template v-if="resumeGame.discCount > 1"> · {{ resumeGame.discCount }} disques</template>
          <template v-if="resumeGame.playtime">
            · {{ formatDurationShort(resumeGame.playtime) }} de jeu
          </template>
        </div>
      </div>
      <div class="resume-actions">
        <button
          type="button"
          class="btn-primary"
          :disabled="!resumeGame.launchable || launchingGameId === resumeGame.id"
          @click="emit('launch', resumeGame)"
        >
          <AppIcon name="play" :size="14" />
          {{ launchingGameId === resumeGame.id ? 'Lancement…' : 'Reprendre' }}
        </button>
        <button type="button" class="btn-ghost" @click="emit('select', resumeGame)">
          Fiche du jeu
        </button>
      </div>

      <div v-if="recentGames.length" class="recent">
        <div class="recent-head">Joués récemment</div>
        <div class="recent-row">
          <div
            v-for="game in recentGames"
            :key="game.id"
            class="recent-tile"
            tabindex="0"
            role="button"
            :aria-label="game.title"
            :data-game-id="game.id"
            data-recent
            @click="emit('select', game)"
            @dblclick="game.launchable && emit('launch', game)"
            @keydown.enter.self="emit('select', game)"
          >
            <span class="recent-cover" aria-hidden="true">
              <img v-if="game.coverUrl" :src="game.coverUrl" alt="" loading="lazy" />
            </span>
            <span class="recent-info">
              <span class="recent-title" :title="game.title">{{ game.title }}</span>
              <span class="recent-meta">
                <template v-if="launchingGameId === game.id">Lancement…</template>
                <template v-else>{{ formatRelative(game.lastPlayed, now) }}</template>
              </span>
            </span>
            <button
              v-if="game.launchable"
              type="button"
              class="recent-play"
              data-nav-skip
              :disabled="launchingGameId === game.id"
              :aria-label="`Lancer ${game.title}`"
              @click.stop="emit('launch', game)"
            >
              <AppIcon name="play" :size="12" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <template v-for="section in showFavorites ? ['favorites', 'all'] : ['all']" :key="section">
      <section class="section" :aria-labelledby="`section-${section}`">
        <div class="section-head">
          <h2 :id="`section-${section}`">{{ section === 'favorites' ? 'Favoris' : title }}</h2>
          <span class="count">{{ section === 'favorites' ? favorites.length : games.length }}</span>
        </div>

        <!-- Grille -->
        <div v-if="view === 'grid'" class="grid">
          <div
            v-for="game in section === 'favorites' ? favorites : sortedGames"
            :key="game.id"
            class="card"
            tabindex="0"
            role="button"
            :aria-label="game.title"
            :data-game-id="game.id"
            :class="{ unavailable: !game.launchable }"
            @click="emit('select', game)"
            @dblclick="game.launchable && emit('launch', game)"
            @keydown.enter.self="emit('select', game)"
          >
            <div class="cover">
              <template v-if="game.coverUrl">
                <img class="cover-backdrop" :src="game.coverUrl" alt="" loading="lazy" />
                <img class="cover-image" :src="game.coverUrl" alt="" loading="lazy" />
              </template>
              <div v-else class="cover-placeholder">{{ game.title }}</div>

              <span v-if="game.playingSince" class="pill"
                ><span class="dot live"></span>En jeu</span
              >
              <span v-else-if="game.platform && !game.launchable" class="pill warn">
                Émulateur absent
              </span>

              <button
                type="button"
                class="fav-toggle"
                data-nav-skip
                :class="{ on: game.favorite }"
                :aria-label="game.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'"
                @click.stop="emit('toggle-favorite', game.id, !game.favorite)"
              >
                <AppIcon :name="game.favorite ? 'star-filled' : 'star'" :size="15" />
              </button>
              <button
                v-if="game.launchable"
                type="button"
                class="play-toggle"
                data-nav-skip
                :aria-label="`Lancer ${game.title}`"
                @click.stop="emit('launch', game)"
              >
                <AppIcon name="play" :size="14" />
              </button>

              <div v-if="launchingGameId === game.id" class="launching">
                <template v-if="progressFor(game)">
                  <span>{{ progressText(progressFor(game)) }}</span>
                  <div class="track">
                    <div
                      class="fill"
                      :style="{ width: progressFor(game).fraction * 100 + '%' }"
                    ></div>
                  </div>
                </template>
                <template v-else>Lancement…</template>
              </div>
            </div>
            <div class="caption">
              <span class="caption-title" :title="game.title">{{ game.title }}</span>
              <span class="caption-meta">{{ metaFor(game) }}</span>
            </div>
          </div>
        </div>

        <!-- Liste -->
        <div v-else-if="view === 'list'" class="list" role="table" aria-label="Jeux">
          <div class="list-head" role="row">
            <span class="col-thumb" role="columnheader"><span class="sr-only">Jaquette</span></span>
            <span class="col-title" role="columnheader">Titre</span>
            <span class="col-platform" role="columnheader">Plateforme</span>
            <span class="col-meta" role="columnheader">Infos</span>
            <span class="col-time" role="columnheader">Temps de jeu</span>
            <span class="col-last" role="columnheader">Dernière session</span>
            <span class="col-play" role="columnheader"><span class="sr-only">Lancer</span></span>
          </div>
          <div
            v-for="game in section === 'favorites' ? favorites : sortedGames"
            :key="game.id"
            class="row"
            role="row"
            tabindex="0"
            :data-game-id="game.id"
            :class="{ unavailable: !game.launchable }"
            @click="emit('select', game)"
            @dblclick="game.launchable && emit('launch', game)"
            @keydown.enter.self="emit('select', game)"
          >
            <span class="col-thumb" role="cell">
              <span class="thumb">
                <img v-if="game.coverUrl" :src="game.coverUrl" alt="" loading="lazy" />
              </span>
            </span>
            <span class="col-title" role="cell">
              <span class="row-title">{{ game.title }}</span>
              <AppIcon v-if="game.favorite" class="row-star" name="star-filled" :size="12" />
              <span v-if="game.playingSince" class="pill inline"
                ><span class="dot live"></span>En jeu</span
              >
            </span>
            <span class="col-platform" role="cell">
              <PlatformIcon v-if="game.platform" :platform="game.platform" :size="16" />
              <span>{{ platformLabel(game.platform) }}</span>
            </span>
            <span class="col-meta" role="cell">
              <template v-if="game.discCount > 1">{{ game.discCount }} disques</template>
              <template v-else-if="game.year">{{ game.year }}</template>
            </span>
            <span class="col-time" role="cell">
              {{ game.playtime ? formatDurationShort(game.playtime) : '—' }}
            </span>
            <span class="col-last" role="cell">
              {{ game.lastPlayed ? formatRelative(game.lastPlayed, now) : '—' }}
            </span>
            <span class="col-play" role="cell">
              <button
                v-if="game.launchable"
                type="button"
                class="row-play"
                data-nav-skip
                :disabled="launchingGameId === game.id"
                :aria-label="`Lancer ${game.title}`"
                @click.stop="emit('launch', game)"
              >
                <AppIcon name="play" :size="12" />
              </button>
              <span v-else-if="game.platform" class="row-warn">Émulateur absent</span>
            </span>
          </div>
        </div>

        <!-- Étagère -->
        <template v-else>
          <div
            v-for="shelf in section === 'favorites'
              ? [{ key: 'fav', name: null, games: favorites }]
              : shelves"
            :key="shelf.key"
            class="shelf"
          >
            <div v-if="shelf.name && shelves.length > 1" class="shelf-head">
              <PlatformIcon v-if="shelf.platform" :platform="shelf.platform" :size="16" />
              <span>{{ shelf.name }}</span>
              <span class="count">{{ shelf.games.length }}</span>
            </div>
            <div class="shelf-row">
              <div
                v-for="game in shelf.games"
                :key="game.id"
                class="box-tile"
                tabindex="0"
                role="button"
                :aria-label="game.title"
                :data-game-id="game.id"
                @click="emit('select', game)"
                @dblclick="game.launchable && emit('launch', game)"
                @keydown.enter.self="emit('select', game)"
                @focus="focusedBoxId = game.id"
                @blur="focusedBoxId = null"
              >
                <GameBox3D
                  :game="game"
                  :platform-label="game.platform ? platformLabel(game.platform) : ''"
                  :active="focusedBoxId === game.id"
                />
                <div class="caption">
                  <span class="caption-title" :title="game.title">
                    <AppIcon v-if="game.favorite" class="row-star" name="star-filled" :size="11" />
                    {{ game.title }}
                  </span>
                  <span class="caption-meta">
                    <template v-if="launchingGameId === game.id">
                      {{ progressFor(game) ? progressText(progressFor(game)) : 'Lancement…' }}
                    </template>
                    <template v-else-if="game.playingSince">En jeu</template>
                    <template v-else>{{ metaFor(game) }}</template>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.library {
  padding: 32px 40px 64px;
  display: flex;
  flex-direction: column;
  gap: 40px;
}

/* --- Reprendre --- */
.resume {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  padding: 20px;
  border-radius: var(--radius-lg);
  background: var(--surface-1);
  border: 1px solid #1f1f23;
}
.resume-cover {
  width: 84px;
  aspect-ratio: 3 / 4;
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface-4);
  flex: none;
}
.resume-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.resume-info {
  flex: 1 1 260px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.resume-info h2 {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.resume-meta {
  font-size: 13px;
  color: var(--text-3);
}
.status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-3);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-4);
  flex: none;
}
.dot.live {
  background: var(--live);
}
.resume-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.btn-primary,
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 20px;
  border-radius: var(--radius);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.btn-primary {
  border: none;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}
.btn-primary:hover:not(:disabled) {
  background: var(--text-strong);
}
.btn-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn-ghost {
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text);
  font-weight: 500;
}
.btn-ghost:hover {
  background: var(--surface-3);
}

/* Joués récemment (dans le bandeau « Reprendre ») */
.recent {
  flex: 1 1 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.recent-head {
  font-size: 12px;
  color: var(--text-3);
}
.recent-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
}
.recent-tile {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 6px;
  border-radius: var(--radius);
  cursor: pointer;
  outline-offset: 2px;
}
.recent-tile:hover {
  background: var(--surface-3);
}
.recent-cover {
  width: 36px;
  aspect-ratio: 3 / 4;
  border-radius: 4px;
  overflow: hidden;
  background: var(--surface-4);
  flex: none;
}
.recent-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.recent-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.recent-title {
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-meta {
  font-size: 12px;
  color: var(--text-3);
}
.recent-play {
  width: 30px;
  height: 30px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.recent-tile:hover .recent-play,
.recent-tile:focus-within .recent-play,
.recent-play:focus-visible {
  opacity: 1;
}
.recent-play:hover:not(:disabled) {
  background: var(--accent);
  color: var(--accent-text);
}

/* --- Sections --- */
.section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.section-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.section-head h2 {
  font-size: 14px;
  font-weight: 600;
}
.count {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

/* --- Grille --- */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
  gap: 28px 20px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  cursor: pointer;
  border-radius: 8px;
  outline-offset: 4px;
}
.cover {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface-3);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s ease;
}
.card:hover .cover {
  outline: 1px solid var(--border-hover);
}
.card.unavailable .cover-image,
.card.unavailable .cover-placeholder {
  opacity: 0.55;
}
.cover-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.2);
  filter: blur(14px) brightness(0.5) saturate(1.1);
}
.cover-image {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.cover-placeholder {
  padding: 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-3);
  text-align: center;
}
.pill {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(11, 11, 12, 0.85);
  font-size: 11px;
  color: var(--text);
}
.pill.warn {
  color: var(--warning);
}
.pill.inline {
  position: static;
  background: var(--surface-3);
}
.fav-toggle,
.play-toggle {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    background 0.15s ease;
}
.fav-toggle {
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(11, 11, 12, 0.75);
  color: var(--text);
}
.fav-toggle.on {
  opacity: 1;
  color: #f5cf63;
}
.play-toggle {
  right: 8px;
  bottom: 8px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-text);
  padding-left: 2px;
}
.card:hover .fav-toggle,
.card:hover .play-toggle,
.card:focus-within .fav-toggle,
.card:focus-within .play-toggle {
  opacity: 1;
}
.fav-toggle:hover {
  background: rgba(11, 11, 12, 0.95);
}
.play-toggle:hover {
  background: var(--text-strong);
}
.launching {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  background: rgba(11, 11, 12, 0.72);
  font-size: 12px;
  font-weight: 500;
  text-align: center;
}
.track {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.15s ease;
}
.caption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.caption-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.caption-meta {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* --- Liste --- */
.list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
}
.list-head,
.row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 190px 90px 110px 140px 120px;
  align-items: center;
  gap: 16px;
  padding: 8px;
  border-bottom: 1px solid var(--border-soft);
}
.list-head {
  padding-top: 10px;
  padding-bottom: 10px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
}
.row {
  cursor: pointer;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-3);
}
.row:hover {
  background: var(--surface-2);
}
.row.unavailable .row-title {
  color: var(--text-2);
}
.thumb {
  display: block;
  width: 30px;
  height: 40px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--surface-4);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.col-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.row-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-star {
  color: #f5cf63;
  flex: none;
  vertical-align: -1px;
}
.col-platform {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.col-time,
.col-last {
  font-variant-numeric: tabular-nums;
}
.col-play {
  display: flex;
  justify-content: flex-end;
}
.row-play {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 2px;
  cursor: pointer;
  opacity: 0;
}
.row:hover .row-play,
.row:focus-within .row-play {
  opacity: 1;
}
.row-play:hover {
  background: var(--accent);
  color: var(--accent-text);
  border-color: var(--accent);
}
.row-warn {
  font-size: 11px;
  color: var(--warning);
}
@media (max-width: 1100px) {
  .list-head,
  .row {
    grid-template-columns: 38px minmax(0, 1fr) 160px 110px 40px;
  }
  .col-meta,
  .col-last {
    display: none;
  }
}

/* --- Étagère --- */
.shelf {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.shelf + .shelf {
  margin-top: 24px;
}
.shelf-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
}
.shelf-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 40px 28px;
}
.box-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  border-radius: 8px;
  outline-offset: 4px;
}
.box-tile .caption {
  max-width: 100%;
  width: 0;
  min-width: 100%;
}
</style>

<!-- Bloc non scopé : en CSS scopé, Vue réduit ":global(html.nav-focus) .card:focus" à
     "html.nav-focus" seul (tout ce qui suit :global() est perdu). -->
<style>
html.nav-focus .card[data-game-id]:focus {
  outline: none;
}
html.nav-focus .card[data-game-id]:focus .cover {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}
</style>
