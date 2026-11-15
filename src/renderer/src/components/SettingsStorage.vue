<script setup>
import { ref, computed, watch } from 'vue'
import { formatRelative } from '../stats-utils'

// Section "Stockage" des Réglages : jeux dont le zip RomStation a été décompressé au lancement (voir
// main/launcher.js), avec la place occupée par les fichiers extraits, et nettoyage
// groupé. Le zip d'origine n'est JAMAIS supprimé : seuls les fichiers qu'un zip voisin
// lisible contient sont effacés (voir main/extraction.js: analyzeExtraction), le jeu
// est simplement re-décompressé au lancement suivant.
const props = defineProps({
  games: { type: Array, required: true }, // bibliothèque enrichie (voir App.vue)
  now: { type: Number, required: true },
  platformCatalog: { type: Object, default: () => ({ labels: {} }) }
})

const emit = defineEmits(['cleaned', 'error', 'open-game'])

const DAY_MS = 24 * 60 * 60 * 1000
const AGE_PRESETS = [
  { days: 30, label: 'Non joués depuis 30 j' },
  { days: 90, label: 'Non joués depuis 3 mois' },
  { days: 180, label: 'Non joués depuis 6 mois' }
]

const analysis = ref({}) // id -> { extractedBytes, zipBytes, fileCount, unsafe, busy }
const analyzing = ref(false)
const cleaning = ref(false)
const confirming = ref(false)
const selected = ref(new Set())
const sortBy = ref('size') // 'size' | 'age'
const lastResult = ref(null)

const extractedGames = computed(() => props.games.filter((game) => game.extracted))

// Copie "plate" des seuls champs utiles (même raison que performLaunch dans App.vue :
// ipcRenderer ne sait pas cloner les Proxy réactifs de Vue).
function plain(game) {
  return {
    id: game.id,
    title: game.title,
    romPath: game.romPath,
    discPaths: Array.isArray(game.discPaths) ? [...game.discPaths] : null
  }
}

async function analyze() {
  const list = extractedGames.value
  if (!list.length) {
    analysis.value = {}
    return
  }
  analyzing.value = true
  try {
    const results = await window.api.analyzeStorage(list.map(plain))
    analysis.value = Object.fromEntries(results.map((entry) => [entry.id, entry]))
  } catch (err) {
    emit('error', err)
  } finally {
    analyzing.value = false
  }
}

// Relancée quand l'ensemble des jeux décompressés change (nouveau lancement, nettoyage,
// rescan) ou qu'une partie commence/se termine (statut "En jeu").
const analysisKey = computed(() =>
  extractedGames.value.map((game) => `${game.id}:${game.playingSince ? 1 : 0}`).join('|')
)
watch(analysisKey, analyze, { immediate: true })

const rows = computed(() => {
  const list = extractedGames.value
    .map((game) => ({ game, info: analysis.value[game.id] }))
    .filter((row) => row.info && (row.info.fileCount > 0 || row.info.unsafe))
  if (sortBy.value === 'age') {
    return list.sort((a, b) => (a.game.lastPlayed || 0) - (b.game.lastPlayed || 0))
  }
  return list.sort((a, b) => b.info.extractedBytes - a.info.extractedBytes)
})

function isSelectable(row) {
  return !row.info.unsafe && !row.info.busy && !row.game.playingSince && row.info.fileCount > 0
}

const totalBytes = computed(() =>
  rows.value.reduce((sum, row) => sum + (row.info.unsafe ? 0 : row.info.extractedBytes), 0)
)

const selectedRows = computed(() =>
  rows.value.filter((row) => selected.value.has(row.game.id) && isSelectable(row))
)
const selectedBytes = computed(() =>
  selectedRows.value.reduce((sum, row) => sum + row.info.extractedBytes, 0)
)

function toggle(row) {
  if (!isSelectable(row)) return
  const next = new Set(selected.value)
  if (next.has(row.game.id)) next.delete(row.game.id)
  else next.add(row.game.id)
  selected.value = next
  confirming.value = false
}

function selectWhere(predicate) {
  selected.value = new Set(
    rows.value.filter((row) => isSelectable(row) && predicate(row)).map((row) => row.game.id)
  )
  confirming.value = false
}

function selectOlderThan(days) {
  const limit = props.now - days * DAY_MS
  selectWhere((row) => !row.game.lastPlayed || row.game.lastPlayed < limit)
}

async function clean() {
  if (!selectedRows.value.length) return
  if (!confirming.value) {
    confirming.value = true
    return
  }
  confirming.value = false
  cleaning.value = true
  lastResult.value = null
  try {
    lastResult.value = await window.api.cleanStorage(selectedRows.value.map((r) => plain(r.game)))
    selected.value = new Set()
    emit('cleaned')
  } catch (err) {
    emit('error', err)
  } finally {
    cleaning.value = false
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 o'
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = value < 10 && unit > 0 ? 1 : 0
  return `${value.toFixed(digits).replace('.', ',')} ${units[unit]}`
}
</script>

<template>
  <div class="storage-section">
    <section class="summary">
      <div class="summary-tile main">
        <span class="summary-value">{{ formatBytes(totalBytes) }}</span>
        <span class="summary-label">
          occupés par le contenu décompressé de {{ rows.length }} jeu{{
            rows.length > 1 ? 'x' : ''
          }}
        </span>
      </div>
      <p class="summary-note">
        Les zips d'origine RomStation sont toujours conservés : seuls les fichiers extraits (et
        présents dans le zip) sont supprimés, le jeu sera de nouveau décompressé à son prochain
        lancement.
      </p>
    </section>

    <div v-if="lastResult" class="result-banner">
      {{ formatBytes(lastResult.freedBytes) }} libérés ({{ lastResult.cleaned }} jeu{{
        lastResult.cleaned > 1 ? 'x' : ''
      }}).
      <template v-if="lastResult.skipped.length">
        Ignorés car en cours d'exécution : {{ lastResult.skipped.join(', ') }}.
      </template>
    </div>

    <p v-if="analyzing && !rows.length" class="state">Analyse de l'espace disque…</p>
    <p v-else-if="!rows.length" class="state">
      Aucun jeu décompressé : rien à nettoyer pour l'instant.
    </p>

    <template v-else>
      <div class="toolbar">
        <div class="presets">
          <button
            v-for="preset in AGE_PRESETS"
            :key="preset.days"
            class="chip"
            @click="selectOlderThan(preset.days)"
          >
            {{ preset.label }}
          </button>
          <button class="chip" @click="selectWhere(() => true)">Tout</button>
          <button class="chip" @click="selectWhere(() => false)">Aucun</button>
        </div>
        <div class="sort">
          <button class="chip" :class="{ active: sortBy === 'size' }" @click="sortBy = 'size'">
            Plus lourds
          </button>
          <button class="chip" :class="{ active: sortBy === 'age' }" @click="sortBy = 'age'">
            Moins récents
          </button>
        </div>
      </div>

      <ul class="rows">
        <li
          v-for="row in rows"
          :key="row.game.id"
          class="row"
          :class="{
            selected: selected.has(row.game.id),
            locked: !isSelectable(row)
          }"
        >
          <label class="row-check">
            <input
              type="checkbox"
              :checked="selected.has(row.game.id)"
              :disabled="!isSelectable(row)"
              @change="toggle(row)"
            />
          </label>
          <img v-if="row.game.coverUrl" class="row-cover" :src="row.game.coverUrl" alt="" />
          <span v-else class="row-cover placeholder">{{ row.game.title.slice(0, 1) }}</span>
          <div class="row-body">
            <button class="row-title" @click="emit('open-game', row.game.id)">
              {{ row.game.title }}
            </button>
            <span class="row-meta">
              {{ platformCatalog.labels?.[row.game.platform] || row.game.platform || '—' }}
              · joué {{ formatRelative(row.game.lastPlayed, now) }} · zip
              {{ formatBytes(row.info.zipBytes) }}
            </span>
          </div>
          <span
            v-if="row.info.unsafe"
            class="row-flag warn"
            title="Un zip du dossier est illisible : les fichiers extraits sont peut-être la seule copie valide, ils ne seront pas supprimés."
          >
            Zip illisible
          </span>
          <span v-else-if="row.info.busy || row.game.playingSince" class="row-flag">En jeu</span>
          <span class="row-size">{{
            row.info.unsafe ? '—' : formatBytes(row.info.extractedBytes)
          }}</span>
        </li>
      </ul>

      <div class="actions">
        <span class="selection-info">
          {{ selectedRows.length }} sélectionné{{ selectedRows.length > 1 ? 's' : '' }} ·
          {{ formatBytes(selectedBytes) }} à libérer
        </span>
        <button
          class="clean-button"
          :class="{ confirming }"
          :disabled="!selectedRows.length || cleaning"
          @click="clean"
          @blur="confirming = false"
        >
          <template v-if="cleaning">Nettoyage…</template>
          <template v-else-if="confirming">Confirmer la suppression ?</template>
          <template v-else>Supprimer le contenu décompressé</template>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.storage-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.summary {
  display: flex;
  gap: 16px;
  align-items: stretch;
  flex-wrap: wrap;
}
.summary-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 20px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(85, 102, 238, 0.35), rgba(85, 102, 238, 0.1));
  border: 1px solid rgba(120, 140, 255, 0.35);
  min-width: 240px;
}
.summary-value {
  font-size: 2rem;
  font-weight: 700;
}
.summary-label {
  font-size: 0.78rem;
  opacity: 0.7;
}
.summary-note {
  flex: 1;
  min-width: 260px;
  margin: 0;
  padding: 14px 18px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 0.82rem;
  opacity: 0.8;
  align-self: center;
}
.result-banner {
  padding: 10px 16px;
  border-radius: 8px;
  background: rgba(123, 220, 154, 0.12);
  color: #9be3b2;
  font-size: 0.85rem;
}
.state {
  padding: 32px;
  text-align: center;
  opacity: 0.75;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.presets,
.sort {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.chip:hover {
  background: rgba(255, 255, 255, 0.06);
}
.chip.active {
  background: rgba(120, 140, 255, 0.18);
  border-color: rgba(120, 140, 255, 0.35);
  color: #cdd6ff;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
}
.row.selected {
  background: rgba(120, 140, 255, 0.12);
  border-color: rgba(120, 140, 255, 0.3);
}
.row.locked {
  opacity: 0.6;
}
.row-check input {
  width: 18px;
  height: 18px;
  cursor: pointer;
}
.row-cover {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}
.row-cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  font-weight: 700;
}
.row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row-title {
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-title:hover {
  text-decoration: underline;
}
.row-meta {
  font-size: 0.75rem;
  opacity: 0.6;
}
.row-flag {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(123, 220, 154, 0.15);
  color: #9be3b2;
  flex-shrink: 0;
}
.row-flag.warn {
  background: rgba(240, 196, 25, 0.15);
  color: #f0c419;
}
.row-size {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  min-width: 80px;
  text-align: right;
  flex-shrink: 0;
}
.actions {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 12px 0;
  background: linear-gradient(transparent, var(--bg) 30%);
}
.selection-info {
  font-size: 0.85rem;
  opacity: 0.75;
}
.clean-button {
  padding: 9px 18px;
  border-radius: 8px;
  border: 1px solid rgba(224, 100, 100, 0.4);
  background: rgba(224, 100, 100, 0.15);
  color: #f0a0a0;
  cursor: pointer;
}
.clean-button.confirming {
  background: rgba(224, 100, 100, 0.35);
  color: #fff;
}
.clean-button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
