<script setup>
import { ref, computed, watch, onMounted } from 'vue'

// Fenêtre "Choisir une jaquette" : recherche en ligne (libretro, ScreenScraper,
// SteamGridDB — voir main/cover-sources.js) et affichage des résultats en grille,
// éditions françaises en tête. Un clic sur une image l'applique comme jaquette du jeu.
// "Jeu suivant sans jaquette" permet d'enchaîner sur toute la bibliothèque sans
// repasser par la liste.
const props = defineProps({
  game: { type: Object, required: true },
  platformLabel: { type: String, default: '' },
  nextGame: { type: Object, default: null },
  missingCount: { type: Number, default: 0 },
  applyingUrl: { type: String, default: null },
  applyError: { type: String, default: null },
  // 'front' : jaquette ; 'back' : dos de la boîte (ScreenScraper uniquement).
  face: { type: String, default: 'front' }
})

const emit = defineEmits(['apply', 'choose-file', 'next', 'close', 'switch-face'])

const query = ref('')
const candidates = ref([])
const errors = ref([])
const loading = ref(false)
const searched = ref(false)
const sources = ref({ libretro: true, screenscraper: false, steamgriddb: false })
const brokenUrls = ref(new Set())

const REGION_LABELS = { fr: 'France', eu: 'Europe', wor: 'Monde', us: 'USA', jp: 'Japon' }

const visibleCandidates = computed(() =>
  candidates.value.filter((c) => !brokenUrls.value.has(c.thumbUrl))
)

let searchToken = 0

async function runSearch() {
  if (!props.game.platform) {
    candidates.value = []
    errors.value = ['Plateforme inconnue : choisis-la d’abord sur la fiche du jeu.']
    searched.value = true
    return
  }
  const token = ++searchToken
  loading.value = true
  errors.value = []
  try {
    const result = await window.api.searchCovers(props.game.platform, query.value, props.face)
    if (token !== searchToken) return
    candidates.value = result.candidates
    errors.value = result.errors
  } catch (err) {
    if (token !== searchToken) return
    candidates.value = []
    errors.value = [err.message || String(err)]
  } finally {
    if (token === searchToken) {
      loading.value = false
      searched.value = true
    }
  }
}

function resetForGame() {
  query.value = props.game.title
  candidates.value = []
  brokenUrls.value = new Set()
  searched.value = false
  runSearch()
}

watch(() => [props.game.id, props.face], resetForGame)

onMounted(async () => {
  resetForGame()
  try {
    sources.value = (await window.api.getCoverSources()).status
  } catch {
    // Simple indication, sans conséquence si indisponible.
  }
})

function onImageError(candidate) {
  brokenUrls.value = new Set([...brokenUrls.value, candidate.thumbUrl])
}

function regionText(candidate) {
  if (candidate.region === 'other') return candidate.regionLabel || ''
  if (candidate.frenchHint && candidate.region !== 'fr') {
    return `${REGION_LABELS[candidate.region] || candidate.regionLabel} · FR`
  }
  return REGION_LABELS[candidate.region] || candidate.regionLabel
}
</script>

<template>
  <div class="modal-backdrop" data-nav-scope @click.self="emit('close')">
    <div class="modal-panel">
      <div class="modal-header">
        <div>
          <h2>{{ face === 'back' ? 'Choisir le dos de la boîte' : 'Choisir une jaquette' }}</h2>
          <p class="modal-subtitle">
            {{ game.title }}<span v-if="platformLabel"> · {{ platformLabel }}</span>
          </p>
        </div>
        <div class="header-actions">
          <div class="segmented" role="group" aria-label="Face de la boîte">
            <button
              type="button"
              :class="{ on: face === 'front' }"
              :aria-pressed="face === 'front'"
              @click="emit('switch-face', 'front')"
            >
              Face
            </button>
            <button
              type="button"
              :class="{ on: face === 'back' }"
              :aria-pressed="face === 'back'"
              @click="emit('switch-face', 'back')"
            >
              Dos
            </button>
          </div>
          <button class="icon-button" data-nav-cancel aria-label="Fermer" @click="emit('close')">
            ✕
          </button>
        </div>
      </div>

      <form class="search-row" @submit.prevent="runSearch">
        <input v-model="query" type="text" placeholder="Titre à rechercher" />
        <button type="submit" :disabled="loading">Rechercher</button>
      </form>

      <p v-if="!sources.screenscraper && face === 'front'" class="hint">
        Astuce : renseigne un compte ScreenScraper dans les Réglages pour davantage de jaquettes
        françaises (et la Switch).
      </p>
      <p v-else-if="face === 'back'" class="hint">
        Dos de boîte issus de LaunchBox (et de ScreenScraper s’il est configuré). Sans dos, la boîte
        3D en génère un à partir de la jaquette.
      </p>
      <p v-for="message in errors" :key="message" class="error">{{ message }}</p>
      <p v-if="applyError" class="error">{{ applyError }}</p>

      <div class="results">
        <p v-if="loading" class="state">Recherche en cours…</p>
        <p v-else-if="searched && !visibleCandidates.length" class="state">
          {{ face === 'back' ? 'Aucun dos trouvé.' : 'Aucune jaquette trouvée.' }} Essaie un autre
          titre (titre anglais, sans sous-titre…).
        </p>
        <div v-else class="grid">
          <button
            v-for="(candidate, index) in visibleCandidates"
            :key="candidate.id"
            class="candidate"
            :class="{ applying: applyingUrl === candidate.url, french: candidate.frenchHint }"
            :data-nav-default="index === 0 ? '' : null"
            :disabled="Boolean(applyingUrl)"
            :title="candidate.label"
            @click="emit('apply', candidate)"
          >
            <span class="thumb">
              <img
                :src="candidate.thumbUrl"
                :alt="candidate.label"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="onImageError(candidate)"
              />
              <span v-if="applyingUrl === candidate.url" class="applying-overlay">
                Application…
              </span>
            </span>
            <span class="meta">
              <span v-if="regionText(candidate)" class="region" :class="candidate.region">
                {{ regionText(candidate) }}
              </span>
              <span class="source">{{ candidate.sourceLabel }}</span>
            </span>
            <span class="label">{{ candidate.label }}</span>
          </button>
        </div>
      </div>

      <div class="footer">
        <button class="link-button" @click="emit('choose-file')">
          Choisir un fichier sur l’ordinateur…
        </button>
        <span class="spacer"></span>
        <button v-if="nextGame && face === 'front'" class="next-button" @click="emit('next')">
          Jeu suivant sans jaquette ({{ missingCount }}) →
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal-panel {
  width: min(980px, 94vw);
  height: min(760px, 90vh);
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 20px 22px;
  box-sizing: border-box;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.modal-header h2 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.segmented {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius);
  border: 1px solid var(--surface-4);
}
.segmented button {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.segmented button.on {
  background: var(--surface-4);
  color: var(--text);
}
.modal-subtitle {
  margin: 0 0 12px;
  font-size: 0.88rem;
  opacity: 0.7;
}
.icon-button {
  background: transparent;
  border: none;
  color: inherit;
  font-size: 1rem;
  cursor: pointer;
  opacity: 0.7;
}
.icon-button:hover {
  opacity: 1;
}
.search-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.search-row input {
  flex: 1;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--surface-4);
  border-radius: var(--radius);
  padding: 8px 12px;
  font: inherit;
  font-size: 13px;
}
.search-row button,
.next-button {
  background: var(--accent);
  color: var(--accent-text);
  border: none;
  border-radius: var(--radius);
  padding: 8px 16px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.search-row button:disabled {
  opacity: 0.5;
  cursor: default;
}
.hint {
  margin: 0 0 6px;
  font-size: 0.75rem;
  opacity: 0.55;
}
.error {
  margin: 0 0 6px;
  font-size: 0.78rem;
  color: #e07a5f;
}
.results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 6px -4px 12px;
  padding: 4px;
}
.state {
  text-align: center;
  opacity: 0.6;
  margin-top: 60px;
  font-size: 0.9rem;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
}
.candidate {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 2px solid transparent;
  border-radius: 8px;
  padding: 8px;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.candidate:hover:not(:disabled),
.candidate:focus-visible {
  border-color: var(--border-hover);
  background: var(--surface-3);
}
.candidate:disabled {
  cursor: default;
  opacity: 0.6;
}
.candidate.applying {
  opacity: 1;
  border-color: var(--text-2);
}
.thumb {
  position: relative;
  aspect-ratio: 3 / 4;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 5px;
  overflow: hidden;
}
.thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.applying-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  font-size: 0.8rem;
}
.meta {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 0.68rem;
}
.region {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}
.region.fr {
  background: rgba(138, 180, 255, 0.2);
  color: #cfe0ff;
}
.candidate.french .region:not(.fr) {
  background: rgba(138, 180, 255, 0.12);
}
.source {
  opacity: 0.5;
}
.label {
  font-size: 0.74rem;
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.footer {
  display: flex;
  align-items: center;
  gap: 10px;
}
.spacer {
  flex: 1;
}
.link-button {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.8rem;
  color: inherit;
  cursor: pointer;
}
.link-button:hover {
  background: rgba(255, 255, 255, 0.06);
}
</style>
