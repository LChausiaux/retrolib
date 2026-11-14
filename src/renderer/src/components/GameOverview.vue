<script setup>
import { ref, computed, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { genreLabel } from '../genres'

// Fiche du jeu tirée de la base LaunchBox (voir main/launchbox-db.js) : genres,
// nombre de joueurs, note, date de sortie et résumé. Le rapprochement se fait par le
// titre : « Pas le bon jeu ? » permet de choisir la bonne fiche à la main.
const props = defineProps({
  game: { type: Object, required: true },
  launchboxStatus: { type: Object, required: true },
  // Incrémenté quand la base devient disponible ou qu'une correspondance change.
  detailsVersion: { type: Number, default: 0 }
})

const emit = defineEmits(['match-changed'])

const result = ref(null)
const expanded = ref(false)
const downloadError = ref(null)

let requestId = 0
async function load() {
  const id = ++requestId
  try {
    const value = await window.api.getGameDetails({
      id: props.game.id,
      title: props.game.title,
      platform: props.game.platform
    })
    if (id === requestId) result.value = value
  } catch {
    if (id === requestId) result.value = null
  }
}

const details = computed(() => (result.value?.status === 'ready' ? result.value.details : null))

// Résumé replié au-delà de quelques lignes.
const LONG_SUMMARY = 420
const isLong = computed(() => (details.value?.overview?.length || 0) > LONG_SUMMARY)

function formatReleaseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  if (!match) return value
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

const playersText = computed(() => {
  const n = details.value?.maxPlayers
  if (!n) return null
  const base = n === 1 ? '1 joueur' : `1 à ${n} joueurs`
  return details.value.cooperative ? `${base} · coop` : base
})

const ratingText = computed(() => {
  const d = details.value
  if (!d?.rating) return null
  return `${d.rating.toLocaleString('fr-FR')}/5`
})

// Développeur / éditeur LaunchBox, seulement quand le catalogue RomStation ne les
// donne pas (ils sont alors déjà affichés plus bas dans la fiche).
const credits = computed(() => {
  const d = details.value
  if (!d) return []
  const list = []
  if (d.developer && !props.game.developer) list.push(`Développé par ${d.developer}`)
  if (d.publisher && !props.game.publisher) list.push(`Édité par ${d.publisher}`)
  return list
})

const downloadText = computed(() => {
  const s = props.launchboxStatus
  if (!s.building) return null
  const percent = s.fraction != null ? ` ${Math.round(s.fraction * 100)} %` : ''
  return s.phase === 'parse'
    ? `Préparation des fiches…${percent}`
    : `Téléchargement de la base LaunchBox…${percent}`
})

async function download() {
  downloadError.value = null
  try {
    await window.api.downloadLaunchbox()
    load()
  } catch (err) {
    downloadError.value = `Téléchargement impossible : ${err?.message || err}`
  }
}

// --- Correction manuelle de la correspondance ---
const fixing = ref(false)
const query = ref('')
const candidates = ref([])
const searching = ref(false)
let searchTimer = null
let searchId = 0

function openFix() {
  fixing.value = true
  query.value = props.game.title
  search()
}

function closeFix() {
  fixing.value = false
  candidates.value = []
  clearTimeout(searchTimer)
}

async function search() {
  const id = ++searchId
  searching.value = true
  try {
    const list = await window.api.searchGameDetails(props.game.platform, query.value)
    if (id === searchId) candidates.value = list
  } catch {
    if (id === searchId) candidates.value = []
  } finally {
    if (id === searchId) searching.value = false
  }
}

function onQueryInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(search, 250)
}

async function choose(launchboxId) {
  await window.api.setGameDetailsMatch(props.game.id, launchboxId)
  closeFix()
  emit('match-changed')
}

function yearOf(date) {
  return date ? String(date).slice(0, 4) : null
}

// Le composant n'est pas recréé en passant d'un jeu à l'autre : on recharge la fiche
// (et on referme la recherche) à chaque changement.
watch(
  () => [props.game.id, props.game.title, props.game.platform, props.detailsVersion],
  (next, previous) => {
    if (!previous || next[0] !== previous[0]) {
      expanded.value = false
      closeFix()
    }
    load()
  },
  { immediate: true }
)
</script>

<template>
  <section v-if="result && result.status !== 'unsupported'" class="overview" aria-label="Fiche">
    <template v-if="details">
      <div
        v-if="details.genres?.length || playersText || ratingText || details.releaseDate"
        class="chips"
      >
        <span v-for="genre in details.genres || []" :key="genre" class="chip">
          {{ genreLabel(genre) }}
        </span>
        <span v-if="playersText" class="chip"
          ><AppIcon name="gamepad" :size="13" />{{ playersText }}</span
        >
        <span
          v-if="ratingText"
          class="chip"
          :title="`Note de la communauté LaunchBox (${details.ratingCount} vote${details.ratingCount > 1 ? 's' : ''})`"
        >
          <AppIcon name="star-filled" :size="12" />{{ ratingText }}
        </span>
        <span v-if="details.releaseDate" class="chip">
          Sorti le {{ formatReleaseDate(details.releaseDate) }}
        </span>
      </div>

      <p v-if="credits.length" class="credits">{{ credits.join(' · ') }}</p>

      <div v-if="details.overview" class="summary-wrap">
        <p class="summary" :class="{ clamped: isLong && !expanded }" lang="en">
          {{ details.overview }}
        </p>
        <button v-if="isLong" type="button" class="link" @click="expanded = !expanded">
          {{ expanded ? 'Réduire' : 'Lire la suite' }}
        </button>
      </div>

      <p class="source">
        Fiche LaunchBox « {{ result.match.name }} »<template v-if="details.overview">
          (résumé en anglais)</template
        >
        ·
        <button v-if="!fixing" type="button" class="link" @click="openFix">Pas le bon jeu ?</button>
      </p>
    </template>

    <p v-else-if="result.status === 'not-found'" class="muted">
      <template v-if="result.overridden">Fiche masquée pour ce jeu.</template>
      <template v-else>Aucune fiche trouvée automatiquement pour ce titre.</template>
      <button v-if="!fixing" type="button" class="link" @click="openFix">Chercher la fiche</button>
    </p>

    <div v-else-if="result.status === 'no-index'" class="muted download">
      <template v-if="downloadText">
        <span>{{ downloadText }}</span>
        <div v-if="launchboxStatus.fraction != null" class="track">
          <div class="fill" :style="{ width: launchboxStatus.fraction * 100 + '%' }"></div>
        </div>
      </template>
      <template v-else>
        <span>Résumé, genres et nombre de joueurs viennent de la base LaunchBox.</span>
        <button type="button" class="btn-small" @click="download">
          <AppIcon name="refresh" :size="14" />Télécharger les fiches (~110 Mo, une fois)
        </button>
      </template>
      <span v-if="downloadError" class="error">{{ downloadError }}</span>
    </div>

    <div v-if="fixing" class="fix">
      <label class="fix-search">
        <span class="sr-only">Titre à chercher</span>
        <input v-model="query" type="search" placeholder="Titre du jeu" @input="onQueryInput" />
      </label>
      <div class="fix-list" role="list">
        <button
          v-for="candidate in candidates"
          :key="candidate.id"
          type="button"
          role="listitem"
          class="fix-item"
          :class="{ current: result.match?.id === candidate.id }"
          @click="choose(candidate.id)"
        >
          <span class="fix-name">{{ candidate.name }}</span>
          <span class="fix-meta">
            {{ [yearOf(candidate.releaseDate), candidate.developer].filter(Boolean).join(' · ') }}
          </span>
        </button>
        <p v-if="!searching && !candidates.length" class="muted">Aucun résultat.</p>
      </div>
      <div class="fix-actions">
        <button type="button" class="btn-small" @click="choose('none')">
          Aucune de ces fiches
        </button>
        <button v-if="result.overridden" type="button" class="btn-small" @click="choose(null)">
          Revenir au choix automatique
        </button>
        <button type="button" class="btn-small" @click="closeFix">Annuler</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--surface-4);
  font-size: 12px;
  color: var(--text-2);
}
.credits {
  font-size: 13px;
  color: var(--text-3);
}
.summary-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  max-width: 680px;
}
.summary {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-2);
  white-space: pre-line;
}
.summary.clamped {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.source,
.muted {
  font-size: 12px;
  color: var(--text-3);
}
.link {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 12px;
  color: var(--text-2);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.link:hover {
  color: var(--text-strong);
}
.muted .link {
  margin-left: 6px;
}
.download {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  max-width: 420px;
}
.track {
  width: 100%;
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
.error {
  color: var(--danger);
}
.btn-small {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--surface-4);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.btn-small:hover {
  background: var(--surface-3);
  color: var(--text);
}
.fix {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface-1);
}
.fix-search input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--surface-4);
  background: var(--surface-1);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.fix-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
}
.fix-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 36px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.fix-item:hover {
  background: var(--surface-3);
  color: var(--text);
}
.fix-item.current {
  background: var(--surface-4);
  color: var(--text-strong);
}
.fix-meta {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
}
.fix-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
