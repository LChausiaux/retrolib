<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import GameLibrary from './components/GameLibrary.vue'
import GamePage from './components/GamePage.vue'
import EmulatorsPage from './components/EmulatorsPage.vue'
import SettingsPage from './components/SettingsPage.vue'
import DiscSelectModal from './components/DiscSelectModal.vue'
import CoverPickerModal from './components/CoverPickerModal.vue'
import StatsPage from './components/StatsPage.vue'
import AppSidebar from './components/AppSidebar.vue'
import AppIcon from './components/AppIcon.vue'
import { installNavigation, navState, focusWhenNavigating } from './navigation'
import { ipcErrorMessage, plainGame } from './ipc'
import { useLibrary } from './composables/useLibrary'
import { useStats } from './composables/useStats'
import { useLaunch } from './composables/useLaunch'
import { useCoverPicker } from './composables/useCoverPicker'
import { useGameMetadata } from './composables/useGameMetadata'
import { usePreference } from './composables/usePreference'
import { useToast } from './composables/useToast'
import { useUpdater } from './composables/useUpdater'

// --- État de l'application (voir composables/) ---
const {
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
} = useLibrary()
const { stats, now, loadStats, enrichedGames } = useStats(games)
const { toast, showToast } = useToast()
const { update, installUpdate } = useUpdater()
// Bandeau « mise à jour prête » masqué pour cette session (elle s'installera quand
// même à la fermeture de RetroLib).
const updateBannerDismissed = ref(false)
const launchError = ref(null)
const {
  launchingGameId,
  discSelectGame,
  launchProgress,
  handleLaunch,
  handleDiscChoice,
  cancelDiscSelect
} = useLaunch(launchError)
const {
  byGame: gameMetadata,
  genres,
  launchboxStatus,
  detailsVersion,
  loadLibraryMetadata,
  refreshDetails
} = useGameMetadata(games)

const sidebarMode = ref('games') // 'games' | 'emulators' | 'stats' | 'settings' — même système de sidebar.
const statsPeriod = ref('all') // 'all' | 'year' | 'month' | 'week' — filtre de la page Stats
const search = ref('')
const platformFilter = ref('')
const genreFilter = ref('')
const emulatorPlatformFilter = ref('')
const settingsSection = ref('library') // section des Réglages, voir settings-sections.js
const selectedGameId = ref(null)

// Recalculé à chaque rechargement de la bibliothèque : si le jeu affiché a été
// modifié entre-temps (plateforme assignée, émulateur choisi...), la page du jeu
// reflète l'état à jour sans qu'on ait besoin de la refermer.
const selectedGame = computed(
  () => enrichedGames.value.find((game) => game.id === selectedGameId.value) || null
)

const {
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
} = useCoverPicker({ games, enrichedGames, selectedGameId, selectedGame, loadLibrary })

// --- Préférences d'affichage de la bibliothèque, mémorisées d'une session à l'autre ---
const VIEW_MODES = [
  { value: 'grid', label: 'Grille', icon: 'grid' },
  { value: 'list', label: 'Liste', icon: 'list' },
  { value: 'shelf', label: 'Étagère', icon: 'shelf' }
]
const SORT_MODES = [
  { value: 'title', label: 'Titre A–Z' },
  { value: 'recent', label: 'Dernière session' },
  { value: 'playtime', label: 'Temps de jeu' },
  { value: 'year', label: 'Année' }
]
const STATS_PERIODS = [
  { value: 'all', label: 'Depuis toujours' },
  { value: 'year', label: '12 derniers mois' },
  { value: 'month', label: '30 derniers jours' },
  { value: 'week', label: '7 derniers jours' }
]
const libraryView = usePreference(
  'retrolib.view',
  VIEW_MODES.map((m) => m.value),
  'grid'
)
const sortMode = usePreference(
  'retrolib.sort',
  SORT_MODES.map((m) => m.value),
  'title'
)

// Ctrl+K : place le curseur dans la recherche.
const searchInput = ref(null)
function onGlobalKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    if (sidebarMode.value !== 'games') return
    event.preventDefault()
    selectedGameId.value = null
    searchInput.value?.focus()
    searchInput.value?.select()
  }
}

// --- Bibliothèque filtrée ---
const ambiguousGames = computed(() => games.value.filter((g) => !g.platform))

// Genre choisi qui n'existe plus (fiches pas encore chargées, jeu supprimé) : filtre
// ignoré plutôt qu'une bibliothèque vide inexplicable.
const activeGenre = computed(() =>
  genres.value.some((g) => g.value === genreFilter.value) ? genreFilter.value : ''
)

const filteredGames = computed(() => {
  const query = search.value.trim().toLowerCase()
  const genre = activeGenre.value
  const list = enrichedGames.value.filter((game) => {
    if (query && !game.title.toLowerCase().includes(query)) return false
    if (genre && !gameMetadata.value[game.id]?.genres.includes(genre)) return false
    if (platformFilter.value === '__unknown__') return !game.platform
    if (platformFilter.value === '__favorites__') return Boolean(game.favorite)
    if (platformFilter.value === '__recent__') return Boolean(game.lastPlayed)
    if (platformFilter.value && game.platform !== platformFilter.value) return false
    return true
  })
  // "Récemment joués" : le plus récent d'abord, au lieu de l'ordre favoris/alphabétique.
  if (platformFilter.value === '__recent__') {
    return [...list].sort((a, b) => b.lastPlayed - a.lastPlayed)
  }
  return list
})

const currentPlatformLabel = computed(() => {
  if (!platformFilter.value) return 'Tous les jeux'
  if (platformFilter.value === '__unknown__') return 'Plateforme inconnue'
  if (platformFilter.value === '__favorites__') return 'Favoris'
  if (platformFilter.value === '__recent__') return 'Récemment joués'
  return platformCatalog.value.labels[platformFilter.value] || platformFilter.value
})

const currentEmulatorLabel = computed(() => {
  if (!emulatorPlatformFilter.value) return 'Tous les émulateurs'
  const found = emulatorStatus.value.find(
    (entry) => entry.platform === emulatorPlatformFilter.value
  )
  return found?.label || emulatorPlatformFilter.value
})

const libraryTitle = computed(() => {
  const base =
    platformFilter.value === '__favorites__' || platformFilter.value === '__recent__'
      ? currentPlatformLabel.value
      : 'Tous les jeux'
  const genre = genres.value.find((g) => g.value === activeGenre.value)
  return genre ? `${base} · ${genre.label}` : base
})

const headerCount = computed(() => {
  if (sidebarMode.value !== 'games' || selectedGame.value) return null
  const n = filteredGames.value.length
  return `${n} jeu${n > 1 ? 'x' : ''}`
})

const headerTitle = computed(() => {
  if (sidebarMode.value === 'emulators') return currentEmulatorLabel.value
  if (sidebarMode.value === 'stats') return 'Mes stats'
  if (sidebarMode.value === 'settings') return 'Réglages'
  return currentPlatformLabel.value
})

// --- Chargement ---

// Rechargement complet (bouton "Relancer le scan", jeux détectés sur le disque) :
// bibliothèque, stats, fiches, puis dos de boîte manquants en arrière-plan.
async function refreshAll() {
  loadStats()
  const added = await loadLibrary()
  loadLibraryMetadata()
  autoAddBackCovers()
  return added
}

// Jeux ajoutés ou supprimés dans le dossier RomStation (voir main/library-watcher.js).
async function handleLibraryChanged() {
  const added = await refreshAll()
  if (added.length === 1) showToast(`Nouveau jeu : ${added[0].title}`)
  else if (added.length > 1) showToast(`${added.length} nouveaux jeux dans la bibliothèque`)
}

// Dos des boîtes ajoutés automatiquement (France, sinon Europe : voir
// main/launchbox-db.js) aux jeux qui n'en ont pas, en arrière-plan, au démarrage et à
// chaque nouveau scan. Réglable dans les Réglages ; jamais bloquant.
let autoBacksRunning = false
async function autoAddBackCovers() {
  if (autoBacksRunning || !configured.value) return
  autoBacksRunning = true
  try {
    const summary = games.value
      .filter((g) => g.platform && g.folderPath && !g.backCoverUrl)
      .map((g) => ({
        id: g.id,
        title: g.title,
        platform: g.platform,
        folderPath: g.folderPath,
        romPath: g.romPath,
        hasBack: false,
        hasSpine: Boolean(g.spineCoverUrl)
      }))
    if (!summary.length) return
    const report = await window.api.autoAddBackCovers(summary)
    if (report?.backs) {
      await loadLibrary()
      showToast(`${report.backs} dos de boîte ajouté${report.backs > 1 ? 's' : ''}`)
    }
  } catch {
    // Hors ligne, base indisponible ou import manuel en cours : on réessaiera.
  } finally {
    autoBacksRunning = false
  }
}

// --- Navigation ---

// Filtre de la barre latérale : ramène toujours à la grille de jeux filtrée, même
// depuis la fiche d'un jeu (sinon la fiche restait affichée par-dessus le filtre).
function selectPlatform(value) {
  platformFilter.value = value
  sidebarMode.value = 'games'
  selectedGameId.value = null
}

// Bouton "Bibliothèque" : retour à l'index complet (fiche fermée, filtres remis à
// zéro), quelle que soit la page affichée.
function selectMode(mode) {
  sidebarMode.value = mode
  if (mode === 'games') {
    platformFilter.value = ''
    genreFilter.value = ''
    selectedGameId.value = null
  }
}

function openGame(game) {
  selectedGameId.value = game.id
  focusWhenNavigating(null)
}

// Page Stats / Réglages (stockage) : un clic sur un jeu ouvre sa fiche dans la bibliothèque.
function openGameFromStats(gameId) {
  if (!games.value.some((game) => game.id === gameId)) return
  sidebarMode.value = 'games'
  selectedGameId.value = gameId
  focusWhenNavigating(null)
}

// Au retour de la fiche (manette/clavier), le focus revient sur la carte du jeu dans
// la liste (pas sur sa vignette de la rubrique « Reprendre »).
function closeGame() {
  const gameId = selectedGameId.value
  selectedGameId.value = null
  if (gameId) focusWhenNavigating(`[data-game-id="${CSS.escape(gameId)}"]:not([data-recent])`)
}

// Retour (B / Échap) quand aucune popup n'est ouverte : ferme la fiche du jeu.
function handleNavBack() {
  if (selectedGameId.value && sidebarMode.value === 'games') {
    closeGame()
    return true
  }
  return false
}

// X : ouvrir la fiche du jeu focalisé ; Y : basculer son favori (sur la fiche, le jeu
// affiché si aucune carte n'a le focus).
function handleNavGameAction(action, gameId) {
  const id = gameId || (sidebarMode.value === 'games' ? selectedGameId.value : null)
  const game = id && games.value.find((g) => g.id === id)
  if (!game) return
  if (action === 'details') {
    sidebarMode.value = 'games'
    openGame(game)
  } else if (action === 'favorite') {
    handleToggleFavorite(game.id, !game.favorite)
  }
}

watch(
  () => navState.gamepadConnected,
  (connected) => {
    const name = navState.gamepadName ? ` : ${navState.gamepadName}` : ''
    showToast(connected ? `Manette connectée${name}` : 'Manette déconnectée')
  }
)

// --- Actions sur les jeux ---

async function handleAssignPlatform(gameId, platform) {
  await window.api.setPlatformOverride(gameId, platform)
  await loadLibrary()
  loadLibraryMetadata()
}

// Affichage optimiste : le favori ne change que ce drapeau et l'ordre de tri, on met
// donc à jour la liste localement sans relancer le scan complet de la bibliothèque.
// En cas d'échec de l'enregistrement, on revient à l'état précédent.
async function handleToggleFavorite(gameId, favorite) {
  patchGame(gameId, { favorite })
  try {
    await window.api.setFavorite(gameId, favorite)
  } catch (err) {
    patchGame(gameId, { favorite: !favorite })
    launchError.value = ipcErrorMessage(err)
  }
}

// Page du jeu : édition manuelle du titre/année/développeur/éditeur — un seul champ
// à la fois, voir GamePage.vue. Le titre sert aussi à retrouver la fiche LaunchBox.
async function handleSetGameMetadata(gameId, metadata) {
  await window.api.setGameMetadata(gameId, metadata)
  await loadLibrary()
  if ('title' in metadata) loadLibraryMetadata()
}

// Page du jeu : "Supprimer le contenu décompressé" — le rechargement fait retomber
// romPath sur le zip (voir extraction.js), le jeu redevient donc "non décompressé".
async function handleClearExtraction(game) {
  launchError.value = null
  try {
    await window.api.clearExtraction(plainGame(game, ['id', 'title', 'romPath', 'discPaths']))
  } catch (err) {
    launchError.value = ipcErrorMessage(err)
  }
  await loadLibrary()
}

// --- Émulateurs ---

async function handleSetEmulatorPreference(platform, emulatorName) {
  await window.api.setEmulatorPreference(platform, emulatorName)
  await loadLibrary()
}

async function handleChooseEmulatorPath(platform) {
  const path = await window.api.chooseEmulatorExecutable()
  if (!path) return
  await window.api.setEmulatorPathOverride(platform, path)
  await loadLibrary()
}

async function handleClearEmulatorPath(platform) {
  await window.api.setEmulatorPathOverride(platform, null)
  await loadLibrary()
}

async function handleSetEmulatorLaunchOptions(platform, options) {
  await window.api.setEmulatorLaunchOptions(platform, options)
  await loadLibrary()
}

async function handleOpenEmulator(emulatorPath, standaloneArgs) {
  launchError.value = null
  try {
    await window.api.openEmulator(emulatorPath, standaloneArgs)
  } catch (err) {
    launchError.value = ipcErrorMessage(err)
  }
}

async function handleOpenEmulatorFolder(emulatorPath) {
  await window.api.openEmulatorFolder(emulatorPath)
}

function handleStorageError(err) {
  launchError.value = ipcErrorMessage(err)
}

// --- Cycle de vie ---

let uninstallNavigation = null
let unsubscribeLibraryChanged = null

onMounted(async () => {
  uninstallNavigation = installNavigation({
    back: handleNavBack,
    gameAction: handleNavGameAction
  })
  window.addEventListener('keydown', onGlobalKeydown)
  unsubscribeLibraryChanged = window.api.onLibraryChanged(handleLibraryChanged)
  await loadLibrary({ silent: false })
  loadLibraryMetadata()
  autoAddBackCovers()
})

onUnmounted(() => {
  uninstallNavigation?.()
  window.removeEventListener('keydown', onGlobalKeydown)
  unsubscribeLibraryChanged?.()
})
</script>

<template>
  <div class="app">
    <AppSidebar
      v-if="configured && !loading"
      v-model:stats-period="statsPeriod"
      v-model:settings-section="settingsSection"
      :mode="sidebarMode"
      :games="enrichedGames"
      :platform-filter="platformFilter"
      :platform-catalog="platformCatalog"
      :stats-periods="STATS_PERIODS"
      :emulator-status="emulatorStatus"
      :emulator-platform-filter="emulatorPlatformFilter"
      @select-platform="selectPlatform"
      @select-mode="selectMode"
      @select-emulator-platform="emulatorPlatformFilter = $event"
    />

    <div class="main-column">
      <header class="app-header">
        <div class="header-title">
          <h1>{{ headerTitle }}</h1>
          <span v-if="headerCount" class="header-count">{{ headerCount }}</span>
          <span v-if="installRoot" class="install-path">{{ installRoot }}</span>
        </div>

        <div v-if="configured && !loading" class="toolbar">
          <label v-if="sidebarMode === 'games'" class="search">
            <AppIcon name="search" :size="15" :stroke="2" />
            <span class="sr-only">Rechercher un jeu</span>
            <input ref="searchInput" v-model="search" type="search" placeholder="Rechercher" />
            <kbd>Ctrl K</kbd>
          </label>

          <template v-if="sidebarMode === 'games' && !selectedGame">
            <label v-if="genres.length" class="select-wrap">
              <span class="sr-only">Genre</span>
              <select v-model="genreFilter" :class="{ active: activeGenre }">
                <option value="">Tous les genres</option>
                <option v-for="genre in genres" :key="genre.value" :value="genre.value">
                  {{ genre.label }} ({{ genre.count }})
                </option>
              </select>
              <AppIcon name="chevron-down" :size="14" :stroke="2" />
            </label>
            <label class="select-wrap">
              <span class="sr-only">Trier par</span>
              <select v-model="sortMode" :disabled="platformFilter === '__recent__'">
                <option v-for="mode in SORT_MODES" :key="mode.value" :value="mode.value">
                  {{ mode.label }}
                </option>
              </select>
              <AppIcon name="chevron-down" :size="14" :stroke="2" />
            </label>
            <div class="view-toggle" role="group" aria-label="Affichage">
              <button
                v-for="mode in VIEW_MODES"
                :key="mode.value"
                type="button"
                :class="{ on: libraryView === mode.value }"
                :aria-pressed="libraryView === mode.value"
                :aria-label="mode.label"
                :title="mode.label"
                @click="libraryView = mode.value"
              >
                <AppIcon :name="mode.icon" :size="15" />
              </button>
            </div>
          </template>

          <button
            type="button"
            class="icon-button"
            title="Relancer le scan"
            aria-label="Relancer le scan"
            @click="refreshAll"
          >
            <AppIcon name="refresh" :size="15" />
          </button>
        </div>
      </header>

      <main data-nav-region="content">
        <div
          v-if="update.status === 'downloaded' && !updateBannerDismissed"
          class="update-banner"
          role="status"
        >
          <span>
            RetroLib {{ update.version }} est prête. Elle s’installera à la fermeture, ou tout de
            suite :
          </span>
          <button type="button" class="update-button" @click="installUpdate">
            Redémarrer maintenant
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label="Plus tard"
            title="Plus tard"
            @click="updateBannerDismissed = true"
          >
            <AppIcon name="close" :size="14" />
          </button>
        </div>

        <div v-if="launchError" class="launch-banner" role="alert">
          <span>{{ launchError }}</span>
          <button type="button" class="icon-button" aria-label="Fermer" @click="launchError = null">
            <AppIcon name="close" :size="14" />
          </button>
        </div>

        <div v-if="loading" class="state-message">Chargement de la bibliothèque…</div>

        <div v-else-if="!configured" class="state-message">
          <p>RomStation n'a pas encore été localisé.</p>
          <button type="button" class="btn" @click="chooseFolder">
            Choisir le dossier d'installation de RomStation
          </button>
        </div>

        <div v-else-if="error" class="state-message error">
          <p>{{ error }}</p>
          <button type="button" class="btn" @click="chooseFolder">
            Changer le dossier RomStation
          </button>
        </div>

        <EmulatorsPage
          v-else-if="sidebarMode === 'emulators'"
          :emulator-status="emulatorStatus"
          :platform-filter="emulatorPlatformFilter"
          @set-preference="handleSetEmulatorPreference"
          @choose-path="handleChooseEmulatorPath"
          @clear-path="handleClearEmulatorPath"
          @set-launch-options="handleSetEmulatorLaunchOptions"
          @open="handleOpenEmulator"
          @open-folder="handleOpenEmulatorFolder"
        />

        <StatsPage
          v-else-if="sidebarMode === 'stats'"
          :games="enrichedGames"
          :stats="stats"
          :period="statsPeriod"
          :now="now"
          :platform-catalog="platformCatalog"
          @open-game="openGameFromStats"
        />

        <SettingsPage
          v-else-if="sidebarMode === 'settings'"
          :section="settingsSection"
          :install-root="installRoot"
          :ambiguous-games="ambiguousGames"
          :platform-catalog="platformCatalog"
          :games="enrichedGames"
          :now="now"
          @library-changed="loadLibrary()"
          @storage-cleaned="loadLibrary()"
          @error="handleStorageError"
          @open-game="openGameFromStats"
          @choose-folder="chooseFolder"
          @assign-platform="handleAssignPlatform"
        />

        <GamePage
          v-else-if="selectedGame"
          :game="selectedGame"
          :platform-catalog="platformCatalog"
          :platforms-with-choice="platformsWithChoice"
          :now="now"
          :sessions="stats.sessions.filter((s) => s.gameId === selectedGame.id)"
          :launching="launchingGameId === selectedGame.id"
          :launch-progress="launchProgress"
          :back-label="currentPlatformLabel"
          :launchbox-status="launchboxStatus"
          :details-version="detailsVersion"
          @back="closeGame"
          @launch="handleLaunch"
          @assign-platform="handleAssignPlatform"
          @set-emulator-preference="handleSetEmulatorPreference"
          @toggle-favorite="handleToggleFavorite"
          @set-metadata="handleSetGameMetadata"
          @choose-cover="openCoverPicker"
          @clear-extraction="handleClearExtraction"
          @match-changed="refreshDetails"
        />

        <div v-else-if="filteredGames.length === 0" class="state-message">
          Aucun jeu ne correspond à la recherche<template v-if="activeGenre">
            dans ce genre</template
          >.
        </div>

        <GameLibrary
          v-else
          :games="filteredGames"
          :view="libraryView"
          :sort="platformFilter === '__recent__' ? 'recent' : sortMode"
          :title="libraryTitle"
          :group-favorites="platformFilter !== '__recent__' && platformFilter !== '__favorites__'"
          :show-resume="!search.trim() && platformFilter !== '__recent__'"
          :mixed-platforms="!platformFilter || platformFilter.startsWith('__')"
          :platform-catalog="platformCatalog"
          :launching-game-id="launchingGameId"
          :launch-progress="launchProgress"
          :now="now"
          @select="openGame"
          @launch="handleLaunch"
          @toggle-favorite="handleToggleFavorite"
        />
      </main>

      <div v-if="navState.mode === 'gamepad'" class="gamepad-hints">
        <span><kbd>◀</kbd><kbd>▶</kbd> Menu / liste</span>
        <span><kbd>A</kbd> Valider</span>
        <span><kbd>B</kbd> Retour</span>
        <span><kbd>X</kbd> Fiche du jeu</span>
        <span><kbd>Y</kbd> Favori</span>
        <span><kbd>LB</kbd><kbd>RB</kbd> Plateforme</span>
        <span><kbd>LT</kbd><kbd>RT</kbd> Section</span>
      </div>
    </div>

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>

    <CoverPickerModal
      v-if="coverPickerOpen && selectedGame"
      :game="selectedGame"
      :face="coverFace"
      :platform-label="platformCatalog.labels[selectedGame.platform] || ''"
      :next-game="nextGameMissingCover"
      :missing-count="gamesMissingCover.filter((g) => g.id !== selectedGame.id).length"
      :applying-url="coverApplyingUrl"
      :apply-error="coverApplyError"
      @apply="handleApplyRemoteCover"
      @choose-file="handleChooseCoverFile"
      @next="goToNextGameMissingCover"
      @switch-face="switchCoverFace"
      @close="closeCoverPicker"
    />
    <DiscSelectModal
      v-if="discSelectGame"
      :game="discSelectGame"
      @choose="handleDiscChoice"
      @cancel="cancelDiscSelect"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  width: 100vw;
  background: var(--bg);
  color: var(--text);
}

/* --- Colonne principale --- */
.main-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.app-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 16px 40px;
  border-bottom: 1px solid var(--border);
}
.header-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex: 1 1 240px;
  min-width: 0;
}
.header-title h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
.header-count {
  font-size: 13px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.install-path {
  font-size: 12px;
  color: var(--text-4);
  font-family: var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  width: 300px;
  max-width: 100%;
  padding: 0 10px 0 12px;
  border-radius: var(--radius);
  background: #141416;
  border: 1px solid var(--surface-4);
  color: var(--text-3);
}
.search:focus-within {
  border-color: var(--border-hover);
}
.search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.search input::placeholder {
  color: var(--text-3);
}
.search input::-webkit-search-cancel-button {
  filter: invert(0.6);
}
.search kbd {
  font-family: var(--font);
  font-size: 11px;
  color: var(--text-3);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 1px 5px;
}
.select-wrap {
  position: relative;
  display: flex;
  align-items: center;
  color: var(--text-2);
}
.select-wrap select {
  appearance: none;
  height: 36px;
  padding: 0 32px 0 12px;
  border-radius: var(--radius);
  border: 1px solid var(--surface-4);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.select-wrap select:hover:not(:disabled) {
  background: var(--surface-3);
}
.select-wrap select.active {
  border-color: var(--border-hover);
  color: var(--text-strong);
}
.select-wrap select:disabled {
  opacity: 0.5;
  cursor: default;
}
.select-wrap select option {
  background: var(--surface-2);
  color: var(--text);
}
.select-wrap svg {
  position: absolute;
  right: 10px;
  pointer-events: none;
}
.view-toggle {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius);
  border: 1px solid var(--surface-4);
}
.view-toggle button {
  width: 30px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.view-toggle button:hover {
  color: var(--text);
}
.view-toggle button.on {
  background: var(--surface-4);
  color: var(--text);
}
.icon-button {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  border: 1px solid var(--surface-4);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.icon-button:hover {
  background: var(--surface-3);
  color: var(--text);
}
main {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.btn {
  height: 40px;
  padding: 0 18px;
  border-radius: var(--radius);
  border: none;
  background: var(--accent);
  color: var(--accent-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.launch-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 40px;
  background: rgba(255, 138, 138, 0.1);
  border-bottom: 1px solid rgba(255, 138, 138, 0.2);
  color: var(--danger);
  font-size: 13px;
}
.update-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 40px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border);
  color: var(--text-2);
  font-size: 13px;
}
.update-banner span {
  flex: 1;
}
.update-button {
  height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.update-banner .icon-button {
  width: 28px;
  height: 28px;
  border: none;
}
.launch-banner .icon-button {
  width: 28px;
  height: 28px;
  border: none;
  color: inherit;
}
.state-message {
  padding: 64px 40px;
  text-align: center;
  color: var(--text-2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.state-message.error {
  color: var(--danger);
}
.toast {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  font-size: 13px;
  z-index: 200;
  pointer-events: none;
}
.gamepad-hints {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 40px;
  border-top: 1px solid var(--border);
  background: var(--surface-1);
  font-size: 12px;
  color: var(--text-2);
}
.gamepad-hints kbd {
  display: inline-block;
  min-width: 18px;
  margin-right: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-4);
  font-family: inherit;
  font-size: 11px;
  text-align: center;
  color: var(--text);
}
</style>
