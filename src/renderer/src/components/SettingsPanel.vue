<script setup>
import { ref, computed, onMounted, onUnmounted, toRaw } from 'vue'
import { useUpdater } from '../composables/useUpdater'

const props = defineProps({
  installRoot: { type: String, default: null },
  ambiguousGames: { type: Array, required: true },
  platformCatalog: { type: Object, required: true },
  games: { type: Array, default: () => [] }
})

const emit = defineEmits(['close', 'choose-folder', 'assign-platform', 'library-changed'])

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
  <div class="overlay" data-nav-scope @click.self="emit('close')">
    <div class="panel">
      <div class="panel-header">
        <h2>Réglages</h2>
        <button class="icon-button" data-nav-cancel @click="emit('close')">✕</button>
      </div>

      <section>
        <h3>Dossier RomStation</h3>
        <p class="current-path">{{ installRoot }}</p>
        <button @click="emit('choose-folder')">Changer de dossier</button>
      </section>

      <section v-if="ambiguousGames.length">
        <h3>Jeux à identifier ({{ ambiguousGames.length }})</h3>
        <p class="hint">
          La plateforme de ces jeux ne peut pas être déduite automatiquement (extension .iso
          notamment). Choisis-la une fois, elle sera mémorisée.
        </p>
        <div v-for="game in ambiguousGames" :key="game.id" class="ambiguous-row">
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
        </div>
      </section>

      <section>
        <h3>Dos et tranches des boîtes</h3>
        <p class="hint">
          Récupère depuis la base LaunchBox (gratuite, sans compte) le dos et la tranche des jeux
          qui n’en ont pas encore, éditions françaises puis européennes en priorité. Ils habillent
          les boîtes 3D (sinon générés à partir de la jaquette). La base est téléchargée une fois
          (~110 Mo) puis gardée 30 jours.
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
          <button type="button" class="secondary" @click="cancelImport">Arrêter</button>
        </div>
        <template v-else>
          <button
            type="button"
            class="primary"
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

      <section>
        <h3>Sources de jaquettes</h3>
        <p class="hint">
          Utilisées par « Changer la jaquette » sur la fiche d’un jeu. Les éditions françaises sont
          proposées en premier.
        </p>
        <p class="source-line">
          <span class="badge on">Actif</span> libretro-thumbnails — gratuit, sans compte (pas de
          Switch)
        </p>
        <p class="source-line">
          <span class="badge on">Actif</span> LaunchBox — gratuit, sans compte, faces et dos
        </p>

        <p class="source-line">
          <span class="badge" :class="{ on: coverStatus.screenscraper }">
            {{ coverStatus.screenscraper ? 'Actif' : 'Inactif' }}
          </span>
          ScreenScraper — site français, jaquettes par région
        </p>
        <p class="hint">
          Nécessite des identifiants développeur (à demander sur le forum screenscraper.fr) et,
          conseillé, un compte utilisateur gratuit (quotas plus élevés).
        </p>
        <div class="field-grid">
          <label>
            <span>ID développeur</span>
            <input v-model="coverSources.ssDevId" type="text" @change="saveCoverField('ssDevId')" />
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
            <input v-model="coverSources.ssUser" type="text" @change="saveCoverField('ssUser')" />
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

        <p class="source-line">
          <span class="badge" :class="{ on: coverStatus.steamgriddb }">
            {{ coverStatus.steamgriddb ? 'Actif' : 'Inactif' }}
          </span>
          SteamGridDB — jaquettes communautaires
        </p>
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
      </section>

      <section>
        <h3>Mises à jour</h3>
        <p class="hint">
          RetroLib<template v-if="appVersion"> {{ appVersion }}</template> — {{ updateText }}
        </p>
        <button
          v-if="update.status === 'downloaded'"
          type="button"
          class="primary"
          @click="installUpdate"
        >
          Redémarrer et installer la version {{ update.version }}
        </button>
        <button
          v-else
          type="button"
          :disabled="['disabled', 'checking', 'downloading'].includes(update.status)"
          @click="checkForUpdates"
        >
          Rechercher une mise à jour
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: flex-end;
}
.panel {
  width: 380px;
  max-width: 100%;
  height: 100%;
  background: #1c1c22;
  overflow-y: auto;
  padding: 20px;
  box-sizing: border-box;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.panel-header h2 {
  margin: 0;
  font-size: 1.1rem;
}
.icon-button {
  cursor: pointer;
  padding: 4px 8px;
}
section {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
section h3 {
  margin: 0 0 8px;
  font-size: 0.9rem;
}
.hint {
  font-size: 0.75rem;
  opacity: 0.6;
  margin: 0 0 10px;
}
.current-path {
  font-size: 0.75rem;
  opacity: 0.7;
  word-break: break-all;
  margin: 0 0 10px;
}
.preference-row,
.ambiguous-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 0.85rem;
}
.game-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
select {
  background: #24242b;
  color: #f0f0f0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 4px 6px;
}
select option {
  background: #24242b;
  color: #f0f0f0;
}
button {
  padding: 6px 12px;
  cursor: pointer;
}
.source-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  margin: 12px 0 6px;
}
.badge {
  flex: 0 0 auto;
  font-size: 0.68rem;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  opacity: 0.7;
}
.badge.on {
  background: rgba(80, 180, 110, 0.2);
  color: #9be3b0;
  opacity: 1;
}
.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.field-grid label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.7rem;
  opacity: 0.8;
  min-width: 0;
}
.field-grid label.wide {
  grid-column: 1 / -1;
}
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
}
.check-row input {
  margin-top: 2px;
  accent-color: var(--accent);
}
.primary,
.secondary {
  border-radius: var(--radius);
  font: inherit;
  font-size: 13px;
  padding: 8px 14px;
  cursor: pointer;
}
.primary {
  border: none;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}
.primary:disabled {
  background: var(--surface-4);
  color: var(--text-3);
  cursor: default;
}
.secondary {
  align-self: flex-start;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-2);
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
.field-grid input {
  background: #24242b;
  color: #f0f0f0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 5px 7px;
  font-size: 0.8rem;
  min-width: 0;
}
</style>
