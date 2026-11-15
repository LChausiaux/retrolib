<script setup>
import { ref, computed, onMounted, onUnmounted, toRaw } from 'vue'
import { useUpdater } from '../composables/useUpdater'
import { SETTINGS_SECTIONS } from '../settings-sections'
import SettingsStorage from './SettingsStorage.vue'

// Page Réglages : une section à la fois, choisie dans la barre latérale (voir
// settings-sections.js). La section Stockage reprend l'ancienne page Stockage.
const props = defineProps({
  installRoot: { type: String, default: null },
  ambiguousGames: { type: Array, required: true },
  platformCatalog: { type: Object, required: true },
  games: { type: Array, default: () => [] }, // bibliothèque enrichie (voir App.vue)
  now: { type: Number, required: true },
  section: { type: String, default: 'library' }
})

const emit = defineEmits([
  'choose-folder',
  'assign-platform',
  'library-changed',
  'storage-cleaned',
  'error',
  'open-game'
])

const SECTION_INTROS = {
  library: 'Emplacement de RomStation et jeux dont la plateforme reste à préciser.',
  covers: 'Dos et tranches des boîtes 3D, et services interrogés pour changer une jaquette.',
  storage:
    'Place occupée par les jeux décompressés au lancement. Les zips d’origine sont toujours conservés.',
  updates: 'RetroLib se met à jour automatiquement depuis les releases GitHub.'
}

const currentSection = computed(
  () => SETTINGS_SECTIONS.find((s) => s.value === props.section) || SETTINGS_SECTIONS[0]
)

// --- Dos et tranches depuis LaunchBox (voir main/launchbox-db.js) ---
// Plateformes présentes dans la base LaunchBox (LAUNCHBOX_PLATFORMS côté main).
const LAUNCHBOX_PLATFORMS = new Set([
  'ps1',
  'ps2',
  'ps3',
  'psp',
  'gamecube',
  'wii',
  'wiiu',
  'switch',
  'n64',
  'snes',
  'gb',
  'gbc',
  'gba',
  'nds',
  '3ds',
  'dreamcast',
  'saturn',
  'xbox360'
])

const missingBoxArt = computed(() =>
  props.games.filter(
    (g) =>
      g.platform &&
      LAUNCHBOX_PLATFORMS.has(g.platform) &&
      g.folderPath &&
      (!g.backCoverUrl || !g.spineCoverUrl)
  )
)

// Ajout automatique du dos (France, sinon Europe) au démarrage : activé par défaut.
const autoBacks = ref(true)

async function toggleAutoBacks(event) {
  autoBacks.value = await window.api.setAutoBackCovers(event.target.checked)
}

const importing = ref(false)
const importProgress = ref(null)
const importReport = ref(null)
const importError = ref(null)
let unsubscribeImport = null

const importStatus = computed(() => {
  const p = importProgress.value
  if (!p) return { text: 'Préparation…', fraction: 0 }
  if (p.phase === 'download') {
    return { text: 'Téléchargement de la base LaunchBox (~110 Mo)…', fraction: p.fraction || 0 }
  }
  if (p.phase === 'parse') return { text: 'Lecture de la base…', fraction: p.fraction || 0 }
  const total = p.total || 1
  return {
    text: `${p.done || 0} / ${p.total} jeux · ${p.backs} dos, ${p.spines} tranches${p.current ? ` · ${p.current}` : ''}`,
    fraction: (p.done || 0) / total
  }
})

async function importBoxArt() {
  importing.value = true
  importProgress.value = null
  importReport.value = null
  importError.value = null
  unsubscribeImport = window.api.onBoxArtProgress((payload) => {
    importProgress.value = payload
  })
  try {
    const games = missingBoxArt.value.map((g) => {
      const game = toRaw(g)
      return {
        id: game.id,
        title: game.title,
        platform: game.platform,
        folderPath: game.folderPath,
        romPath: game.romPath,
        hasBack: Boolean(game.backCoverUrl),
        hasSpine: Boolean(game.spineCoverUrl)
      }
    })
    importReport.value = await window.api.importBoxArt(games)
    emit('library-changed')
  } catch (err) {
    importError.value = (err?.message || String(err)).replace(
      /^Error invoking remote method '[^']+':\s*(Error:\s*)?/,
      ''
    )
  } finally {
    importing.value = false
    unsubscribeImport?.()
    unsubscribeImport = null
  }
}

function cancelImport() {
  window.api.cancelBoxArtImport()
}

onUnmounted(() => unsubscribeImport?.())

const appVersion = ref(null)
const { update, statusText: updateText, checkForUpdates, installUpdate } = useUpdater()

// Sources de jaquettes en ligne (voir main/cover-sources.js) : libretro fonctionne
// sans rien ; ScreenScraper et SteamGridDB ne sont interrogés qu'une fois leurs
// identifiants renseignés ici. Enregistrement champ par champ, au blur/Entrée.
const coverSources = ref({
  ssDevId: '',
  ssDevPassword: '',
  ssUser: '',
  ssPassword: '',
  steamGridDbKey: ''
})
const coverStatus = ref({ libretro: true, screenscraper: false, steamgriddb: false })

onMounted(async () => {
  try {
    autoBacks.value = await window.api.getAutoBackCovers()
  } catch {
    // Case affichée cochée (valeur par défaut).
  }
  try {
    appVersion.value = await window.api.getAppVersion()
  } catch {
    // Version simplement non affichée.
  }
  try {
    const { settings, status } = await window.api.getCoverSources()
    coverSources.value = { ...coverSources.value, ...settings }
    coverStatus.value = status
  } catch {
    // Section affichée vide, sans conséquence.
  }
})

async function saveCoverField(field) {
  coverStatus.value = await window.api.setCoverSources({ [field]: coverSources.value[field] })
}

function onAssign(gameId, event) {
  const platform = event.target.value
  if (!platform) return
  emit('assign-platform', gameId, platform)
}

function platformLabel(platform) {
  return props.platformCatalog.labels[platform] || platform
}
</script>

<template>
  <div class="settings-page">
    <div class="settings-inner">
      <header class="section-header">
        <h2>{{ currentSection.label }}</h2>
        <p>{{ SECTION_INTROS[currentSection.value] }}</p>
      </header>

      <!-- Bibliothèque -->
      <template v-if="currentSection.value === 'library'">
        <section class="card">
          <div class="setting-row">
            <div class="setting-text">
              <h3>Dossier RomStation</h3>
              <p class="path">{{ installRoot || 'Non défini' }}</p>
            </div>
            <button type="button" class="btn" @click="emit('choose-folder')">
              Changer de dossier
            </button>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <h3>Jeux à identifier</h3>
            <span v-if="ambiguousGames.length" class="badge warn">{{ ambiguousGames.length }}</span>
          </div>
          <template v-if="ambiguousGames.length">
            <p class="hint">
              La plateforme de ces jeux ne peut pas être déduite automatiquement (extension .iso
              notamment). Choisis-la une fois, elle sera mémorisée.
            </p>
            <ul class="list">
              <li v-for="game in ambiguousGames" :key="game.id" class="list-row">
                <span class="game-title">{{ game.title }}</span>
                <select value="" @change="onAssign(game.id, $event)">
                  <option value="" disabled>Choisir la plateforme…</option>
                  <option
                    v-for="platform in platformCatalog.assignable"
                    :key="platform"
                    :value="platform"
                  >
                    {{ platformLabel(platform) }}
                  </option>
                </select>
              </li>
            </ul>
          </template>
          <p v-else class="hint flush">Tous les jeux ont une plateforme : rien à faire.</p>
        </section>
      </template>

      <!-- Jaquettes -->
      <template v-else-if="currentSection.value === 'covers'">
        <section class="card">
          <h3>Dos et tranches des boîtes</h3>
          <p class="hint">
            Récupérés depuis la base LaunchBox (gratuite, sans compte) pour les jeux qui n’en ont
            pas encore, éditions françaises puis européennes en priorité. Ils habillent les boîtes
            3D (sinon générés à partir de la jaquette). La base est téléchargée une fois (~110 Mo)
            puis gardée 30 jours.
          </p>
          <label class="check-row">
            <input type="checkbox" :checked="autoBacks" @change="toggleAutoBacks" />
            <span>
              Ajouter automatiquement le dos des jeux qui n’en ont pas (édition française, sinon
              européenne) au démarrage et à chaque nouveau scan
            </span>
          </label>
          <div v-if="importing" class="import-progress">
            <span class="import-text">{{ importStatus.text }}</span>
            <div class="track">
              <div class="fill" :style="{ width: importStatus.fraction * 100 + '%' }"></div>
            </div>
            <button type="button" class="btn ghost" @click="cancelImport">Arrêter</button>
          </div>
          <template v-else>
            <button
              type="button"
              class="btn primary"
              :disabled="!missingBoxArt.length"
              @click="importBoxArt"
            >
              {{
                missingBoxArt.length
                  ? `Récupérer les dos et tranches manquants (${missingBoxArt.length} jeux)`
                  : 'Tous les jeux ont leur dos et leur tranche'
              }}
            </button>
            <p v-if="importReport" class="import-report">
              {{ importReport.cancelled ? 'Import arrêté' : 'Terminé' }} :
              {{ importReport.backs }} dos et {{ importReport.spines }} tranches ajoutés<template
                v-if="importReport.unmatched"
              >
                · {{ importReport.unmatched }} jeux sans dos français ou européen trouvé (à faire
                depuis la fiche du jeu)</template
              ><template v-if="importReport.errors"> · {{ importReport.errors }} erreurs</template>.
            </p>
            <p v-if="importError" class="import-error">{{ importError }}</p>
          </template>
        </section>

        <section class="card">
          <h3>Sources de jaquettes</h3>
          <p class="hint">
            Utilisées par « Changer la jaquette » sur la fiche d’un jeu. Les éditions françaises
            sont proposées en premier.
          </p>

          <div class="source">
            <div class="source-head">
              <span class="badge on">Actif</span>
              <strong>libretro-thumbnails</strong>
              <span class="source-desc">gratuit, sans compte (pas de Switch)</span>
            </div>
          </div>
          <div class="source">
            <div class="source-head">
              <span class="badge on">Actif</span>
              <strong>LaunchBox</strong>
              <span class="source-desc">gratuit, sans compte, faces et dos</span>
            </div>
          </div>

          <div class="source">
            <div class="source-head">
              <span class="badge" :class="{ on: coverStatus.screenscraper }">
                {{ coverStatus.screenscraper ? 'Actif' : 'Inactif' }}
              </span>
              <strong>ScreenScraper</strong>
              <span class="source-desc">site français, jaquettes par région</span>
            </div>
            <p class="hint">
              Nécessite des identifiants développeur (à demander sur le forum screenscraper.fr) et,
              conseillé, un compte utilisateur gratuit (quotas plus élevés).
            </p>
            <div class="field-grid">
              <label>
                <span>ID développeur</span>
                <input
                  v-model="coverSources.ssDevId"
                  type="text"
                  @change="saveCoverField('ssDevId')"
                />
              </label>
              <label>
                <span>Mot de passe développeur</span>
                <input
                  v-model="coverSources.ssDevPassword"
                  type="password"
                  @change="saveCoverField('ssDevPassword')"
                />
              </label>
              <label>
                <span>Identifiant utilisateur</span>
                <input
                  v-model="coverSources.ssUser"
                  type="text"
                  @change="saveCoverField('ssUser')"
                />
              </label>
              <label>
                <span>Mot de passe utilisateur</span>
                <input
                  v-model="coverSources.ssPassword"
                  type="password"
                  @change="saveCoverField('ssPassword')"
                />
              </label>
            </div>
          </div>

          <div class="source">
            <div class="source-head">
              <span class="badge" :class="{ on: coverStatus.steamgriddb }">
                {{ coverStatus.steamgriddb ? 'Actif' : 'Inactif' }}
              </span>
              <strong>SteamGridDB</strong>
              <span class="source-desc">jaquettes communautaires</span>
            </div>
            <p class="hint">Clé d’API gratuite : steamgriddb.com → Préférences → API.</p>
            <div class="field-grid">
              <label class="wide">
                <span>Clé d’API</span>
                <input
                  v-model="coverSources.steamGridDbKey"
                  type="password"
                  @change="saveCoverField('steamGridDbKey')"
                />
              </label>
            </div>
          </div>
        </section>
      </template>

      <!-- Stockage (ancienne page Stockage) -->
      <SettingsStorage
        v-else-if="currentSection.value === 'storage'"
        :games="games"
        :now="now"
        :platform-catalog="platformCatalog"
        @cleaned="emit('storage-cleaned')"
        @error="emit('error', $event)"
        @open-game="emit('open-game', $event)"
      />

      <!-- Mises à jour -->
      <section v-else-if="currentSection.value === 'updates'" class="card">
        <div class="setting-row">
          <div class="setting-text">
            <h3>
              RetroLib<template v-if="appVersion"> {{ appVersion }}</template>
            </h3>
            <p class="hint flush">{{ updateText }}</p>
          </div>
          <button
            v-if="update.status === 'downloaded'"
            type="button"
            class="btn primary"
            @click="installUpdate"
          >
            Redémarrer et installer la version {{ update.version }}
          </button>
          <button
            v-else
            type="button"
            class="btn"
            :disabled="['disabled', 'checking', 'downloading'].includes(update.status)"
            @click="checkForUpdates"
          >
            Rechercher une mise à jour
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  padding: 28px 40px 40px;
}
.settings-inner {
  max-width: 820px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.section-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.section-header p {
  margin: 6px 0 8px;
  font-size: 13px;
  color: var(--text-3);
}
.card {
  padding: 18px 20px;
  border-radius: var(--radius-lg);
  background: var(--surface-1);
  border: 1px solid var(--border);
}
.card h3 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.card-head h3 {
  margin: 0;
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.setting-text {
  min-width: 0;
}
.path {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-3);
  word-break: break-all;
}
.hint {
  margin: 0 0 12px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-3);
}
.hint.flush {
  margin: 0;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
}
.list-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.list-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.game-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
select,
.field-grid input {
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  min-width: 0;
}
select:focus,
.field-grid input:focus {
  outline: none;
  border-color: var(--border-hover);
}
select option {
  background: var(--surface-2);
  color: var(--text);
}
.btn {
  flex: none;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface-3);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  border-color: var(--border-hover);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn.primary {
  border: none;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}
.btn.primary:disabled {
  opacity: 1;
  background: var(--surface-4);
  color: var(--text-3);
}
.btn.ghost {
  align-self: flex-start;
  background: transparent;
  color: var(--text-2);
}
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
}
.check-row input {
  margin-top: 2px;
  accent-color: var(--accent);
}
.import-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.import-text {
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track {
  height: 4px;
  border-radius: 999px;
  background: var(--surface-4);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}
.import-report {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-2);
}
.import-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--danger);
}
.source {
  padding: 14px 0;
  border-top: 1px solid var(--border);
}
.source:last-child {
  padding-bottom: 0;
}
.source .hint {
  margin: 8px 0 10px;
}
.source-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
}
.source-desc {
  color: var(--text-3);
  font-size: 12.5px;
}
.badge {
  flex: none;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--surface-4);
  color: var(--text-3);
}
.badge.on {
  background: rgba(74, 222, 128, 0.14);
  color: var(--live);
}
.badge.warn {
  background: rgba(245, 185, 113, 0.14);
  color: var(--warning);
}
.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.field-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-3);
  min-width: 0;
}
.field-grid label.wide {
  grid-column: 1 / -1;
}
</style>
