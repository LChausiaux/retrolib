<script setup>
import { ref, computed, watch } from 'vue'
import GameStats from './GameStats.vue'
import BoxViewer3D from './BoxViewer3D.vue'
import GameOverview from './GameOverview.vue'
import AppIcon from './AppIcon.vue'
import { formatDuration, formatRelative } from '../stats-utils'

const props = defineProps({
  game: { type: Object, required: true },
  platformCatalog: { type: Object, required: true },
  platformsWithChoice: { type: Array, required: true },
  launching: { type: Boolean, default: false },
  launchProgress: { type: Object, default: null },
  sessions: { type: Array, default: () => [] },
  now: { type: Number, default: () => Date.now() },
  // Libellé du lien de retour (plateforme ou filtre d'où l'on vient).
  backLabel: { type: String, default: 'Bibliothèque' },
  // Fiche LaunchBox (voir GameOverview.vue et composables/useGameMetadata.js).
  launchboxStatus: { type: Object, required: true },
  detailsVersion: { type: Number, default: 0 }
})

const emit = defineEmits([
  'back',
  'launch',
  'assign-platform',
  'set-emulator-preference',
  'toggle-favorite',
  'set-metadata',
  'choose-cover',
  'clear-extraction',
  'match-changed'
])

function platformLabel(platform) {
  return props.platformCatalog.labels[platform] || platform
}

// --- Boîte 3D : orientation ---
const VIEWS = [
  { id: 'face', label: 'Face' },
  { id: 'tranche', label: 'Tranche' },
  { id: 'dos', label: 'Dos' }
]
const boxView = ref('face')
const viewKey = ref(0)
function pickView(id) {
  boxView.value = id
  viewKey.value++
}

// --- Disque à lancer (jeux multi-disques) ---
const disc = ref(0)
const discs = computed(() =>
  Array.from({ length: props.game.discCount || 1 }, (_, i) => ({
    index: i,
    label: `Disque ${i + 1}`
  }))
)

function launch() {
  emit('launch', props.game, props.game.discCount > 1 ? disc.value : 0)
}

const progress = computed(() => {
  const p = props.launchProgress
  return props.launching && p && p.gameId === props.game.id && p.fraction < 1 ? p : null
})

// --- Menu "Plus d'options" ---
const menuOpen = ref(false)
function menuAction(action) {
  menuOpen.value = false
  action()
}

// "Supprimer le contenu décompressé" : supprime des fichiers sur disque, donc
// confirmation en deux clics (premier clic = arme le bouton, second = exécute).
const confirmingClear = ref(false)
function onClearExtraction() {
  if (!confirmingClear.value) {
    confirmingClear.value = true
    return
  }
  confirmingClear.value = false
  emit('clear-extraction', props.game)
}

// --- Édition des infos (titre, année, développeur, éditeur) ---
// Repliée par défaut : le catalogue RomStation a déjà les bonnes infos dans
// l'immense majorité des cas. Sauvegarde à la volée, un champ à la fois ; un champ
// vidé retombe sur la valeur déduite automatiquement (voir config.js côté main).
const editingInfo = ref(false)
const titleInput = ref('')
const yearInput = ref('')
const developerInput = ref('')
const publisherInput = ref('')

function openInfoEdit() {
  titleInput.value = props.game.title || ''
  yearInput.value = props.game.year || ''
  developerInput.value = props.game.developer || ''
  publisherInput.value = props.game.publisher || ''
  editingInfo.value = true
}

function saveField(field, value) {
  emit('set-metadata', props.game.id, { [field]: value })
}

// Le composant n'est pas redémonté en changeant de jeu : on remet son état à zéro.
watch(
  () => props.game.id,
  () => {
    editingInfo.value = false
    confirmingClear.value = false
    menuOpen.value = false
    disc.value = 0
    pickView('face')
  }
)

// --- Émulateur ---
const emulatorChoice = computed(
  () => props.platformsWithChoice.find((entry) => entry.platform === props.game.platform) || null
)

function onAssign(event) {
  const platform = event.target.value
  if (platform) emit('assign-platform', props.game.id, platform)
}

function onPreference(event) {
  emit('set-emulator-preference', props.game.platform, event.target.value)
}

const metaLine = computed(() =>
  [
    props.game.platform ? platformLabel(props.game.platform) : 'Plateforme inconnue',
    props.game.developer || props.game.publisher,
    props.game.discCount > 1 ? `${props.game.discCount} disques` : null
  ]
    .filter(Boolean)
    .join(' · ')
)
</script>

<template>
  <div class="game-page">
    <div class="page-head">
      <button type="button" class="back-link" @click="emit('back')">
        <AppIcon name="chevron-left" :size="16" :stroke="2" />{{ backLabel }}
      </button>
    </div>

    <div class="content">
      <!-- Boîte 3D -->
      <div class="box-column">
        <BoxViewer3D
          :game="game"
          :platform-label="game.platform ? platformLabel(game.platform) : ''"
          :view="boxView"
          :view-key="viewKey"
        />
        <div class="box-controls">
          <div class="segmented" role="group" aria-label="Orientation de la boîte">
            <button
              v-for="v in VIEWS"
              :key="v.id"
              type="button"
              :class="{ on: boxView === v.id }"
              :aria-pressed="boxView === v.id"
              @click="pickView(v.id)"
            >
              {{ v.label }}
            </button>
          </div>
          <span class="hint">Glisser pour faire tourner la boîte</span>
          <div class="cover-buttons">
            <button type="button" class="btn-small" @click="emit('choose-cover', game, 'front')">
              <AppIcon name="image" :size="14" />Jaquette
            </button>
            <button type="button" class="btn-small" @click="emit('choose-cover', game, 'back')">
              <AppIcon name="image" :size="14" />{{ game.backCoverUrl ? 'Dos' : 'Ajouter le dos' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Infos -->
      <div class="info">
        <div class="heading">
          <div v-if="game.playingSince" class="status"><span class="dot live"></span>En cours</div>
          <div v-else-if="game.lastPlayed" class="status">
            <span class="dot"></span>Joué {{ formatRelative(game.lastPlayed, now) }}
          </div>
          <h1>{{ game.title }}</h1>
          <div class="meta">{{ metaLine }}</div>
        </div>

        <div v-if="game.discCount > 1" class="field">
          <span class="field-label">Disque</span>
          <div class="discs" role="group" aria-label="Choix du disque">
            <button
              v-for="d in discs"
              :key="d.index"
              type="button"
              :class="{ on: disc === d.index }"
              :aria-pressed="disc === d.index"
              @click="disc = d.index"
            >
              {{ d.label }}
            </button>
          </div>
        </div>

        <div class="actions">
          <button
            type="button"
            class="btn-play"
            data-nav-default
            :disabled="!game.launchable || launching"
            :title="!game.launchable ? 'Émulateur non détecté pour cette plateforme' : ''"
            @click="launch"
          >
            <AppIcon name="play" :size="14" />
            <template v-if="launching">Lancement…</template>
            <template v-else-if="!game.launchable">Émulateur introuvable</template>
            <template v-else-if="game.discCount > 1">Jouer — disque {{ disc + 1 }}</template>
            <template v-else>Jouer</template>
          </button>
          <button
            type="button"
            class="btn-square"
            :class="{ on: game.favorite }"
            :aria-pressed="game.favorite"
            :aria-label="game.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'"
            @click="emit('toggle-favorite', game.id, !game.favorite)"
          >
            <AppIcon :name="game.favorite ? 'star-filled' : 'star'" :size="18" />
          </button>
          <div class="menu-wrap">
            <button
              type="button"
              class="btn-square"
              aria-label="Plus d’options"
              :aria-expanded="menuOpen"
              @click="menuOpen = !menuOpen"
            >
              <AppIcon name="more" :size="18" />
            </button>
            <div v-if="menuOpen" class="menu" role="menu" @keydown.esc="menuOpen = false">
              <button type="button" role="menuitem" @click="menuAction(openInfoEdit)">
                <AppIcon name="edit" :size="14" />Modifier les infos
              </button>
              <button
                type="button"
                role="menuitem"
                @click="menuAction(() => emit('choose-cover', game, 'front'))"
              >
                <AppIcon name="image" :size="14" />Changer la jaquette
              </button>
              <button
                type="button"
                role="menuitem"
                @click="menuAction(() => emit('choose-cover', game, 'back'))"
              >
                <AppIcon name="image" :size="14" />{{
                  game.backCoverUrl ? 'Changer le dos' : 'Ajouter le dos de la boîte'
                }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="progress" class="progress">
          <span>
            Décompression<template v-if="progress.discCount > 1">
              (disque {{ progress.discIndex + 1 }}/{{ progress.discCount }})</template
            >… {{ Math.round(progress.fraction * 100) }} %
          </span>
          <div class="track">
            <div class="fill" :style="{ width: progress.fraction * 100 + '%' }"></div>
          </div>
        </div>
        <p v-else-if="game.discCount > 1 && !game.extracted" class="note">
          Le premier lancement peut prendre du temps : les disques sont extraits des zips
          RomStation, une seule fois.
        </p>

        <GameOverview
          :game="game"
          :launchbox-status="launchboxStatus"
          :details-version="detailsVersion"
          @match-changed="emit('match-changed')"
        />

        <div v-if="editingInfo" class="info-edit">
          <label>
            <span>Titre</span>
            <input v-model="titleInput" type="text" @change="saveField('title', titleInput)" />
          </label>
          <label>
            <span>Année</span>
            <input
              v-model="yearInput"
              type="text"
              placeholder="ex : 1998"
              @change="saveField('year', yearInput)"
            />
          </label>
          <label>
            <span>Développeur</span>
            <input
              v-model="developerInput"
              type="text"
              @change="saveField('developer', developerInput)"
            />
          </label>
          <label>
            <span>Éditeur</span>
            <input
              v-model="publisherInput"
              type="text"
              @change="saveField('publisher', publisherInput)"
            />
          </label>
          <button type="button" class="btn-small" @click="editingInfo = false">Fermer</button>
        </div>

        <dl class="details">
          <dt>Plateforme</dt>
          <dd>
            <template v-if="game.platform">{{ platformLabel(game.platform) }}</template>
            <select v-else class="select" value="" @change="onAssign">
              <option value="" disabled>Choisir la plateforme…</option>
              <option
                v-for="platform in platformCatalog.assignable"
                :key="platform"
                :value="platform"
              >
                {{ platformLabel(platform) }}
              </option>
            </select>
          </dd>

          <dt>Émulateur</dt>
          <dd>
            <template v-if="game.emulatorOverridden">
              {{ game.emulatorName }} <span class="muted">(chemin personnalisé)</span>
            </template>
            <select
              v-else-if="game.platform && emulatorChoice"
              class="select"
              :value="emulatorChoice.current"
              @change="onPreference"
            >
              <option v-for="name in emulatorChoice.options" :key="name" :value="name">
                {{ name }}
              </option>
            </select>
            <template v-else-if="game.launchable">{{ game.emulatorName }}</template>
            <span v-else-if="game.platform" class="warn">Aucun émulateur détecté</span>
            <span v-else class="muted">—</span>
          </dd>

          <dt>Temps de jeu</dt>
          <dd class="num">{{ game.playtime ? formatDuration(game.playtime) : 'Jamais joué' }}</dd>

          <dt>Dernière session</dt>
          <dd>{{ game.lastPlayed ? formatRelative(game.lastPlayed, now) : '—' }}</dd>

          <template v-if="game.year">
            <dt>Année</dt>
            <dd class="num">{{ game.year }}</dd>
          </template>
          <template v-if="game.developer">
            <dt>Développeur</dt>
            <dd>{{ game.developer }}</dd>
          </template>
          <template v-if="game.publisher">
            <dt>Éditeur</dt>
            <dd>{{ game.publisher }}</dd>
          </template>

          <dt>Emplacement</dt>
          <dd class="path">{{ game.romPath }}</dd>

          <template v-if="game.extracted">
            <dt>Décompressé</dt>
            <dd>
              <button
                type="button"
                class="btn-small"
                :class="{ danger: confirmingClear }"
                :disabled="launching"
                title="Supprime les fichiers extraits (le zip est conservé) : le jeu sera de nouveau décompressé au prochain lancement"
                @click="onClearExtraction"
                @blur="confirmingClear = false"
              >
                <AppIcon name="trash" :size="14" />
                {{
                  confirmingClear
                    ? 'Confirmer la suppression ?'
                    : 'Supprimer le contenu décompressé'
                }}
              </button>
            </dd>
          </template>
        </dl>
      </div>
    </div>

    <GameStats class="stats-block" :game="game" :sessions="sessions" :now="now" />
  </div>
</template>

<style scoped>
.game-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.page-head {
  padding: 12px 40px 0;
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
}
.back-link:hover {
  color: var(--text-strong);
}
.content {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 40px 40px;
  display: flex;
  flex-wrap: wrap;
  gap: 56px;
  align-items: flex-start;
}
.box-column {
  flex: 0 1 480px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.box-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.segmented,
.discs {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius);
  border: 1px solid var(--surface-4);
}
.segmented button {
  height: 32px;
  padding: 0 14px;
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
.hint {
  font-size: 12px;
  color: var(--text-3);
}
.cover-buttons {
  display: flex;
  gap: 8px;
  margin-top: 4px;
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
.btn-small:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--text);
}
.btn-small:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn-small.danger {
  border-color: #6b2e2e;
  color: var(--danger);
}

.info {
  flex: 1 1 420px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.heading {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
}
.dot.live {
  background: var(--live);
}
h1 {
  font-size: 40px;
  line-height: 1.1;
  font-weight: 600;
  letter-spacing: -0.03em;
}
.meta {
  font-size: 14px;
  color: var(--text-3);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field-label {
  font-size: 12px;
  color: var(--text-3);
}
.discs {
  border: none;
  padding: 0;
  gap: 8px;
  flex-wrap: wrap;
}
.discs button {
  height: 40px;
  padding: 0 16px;
  border-radius: var(--radius);
  border: 1px solid var(--surface-4);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.discs button.on {
  background: var(--surface-4);
  border-color: var(--border-hover);
  color: var(--text-strong);
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.btn-play {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 28px;
  border: none;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--accent-text);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.btn-play:hover:not(:disabled) {
  background: var(--text-strong);
}
.btn-play:disabled {
  background: var(--surface-4);
  color: var(--text-3);
  cursor: not-allowed;
}
.btn-square {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.btn-square:hover {
  background: var(--surface-3);
}
.btn-square.on {
  color: #f5cf63;
}
.menu-wrap {
  position: relative;
}
.menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  min-width: 240px;
  padding: 4px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}
.menu button {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.menu button:hover {
  background: var(--surface-4);
  color: var(--text);
}
.progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 360px;
  font-size: 12px;
  color: var(--text-3);
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
  transition: width 0.15s ease;
}
.note {
  font-size: 12px;
  color: var(--text-3);
  max-width: 480px;
}
.info-edit {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px 16px;
  padding: 16px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface-1);
}
.info-edit label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-3);
}
.info-edit input,
.select {
  height: 34px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--surface-4);
  background: var(--surface-1);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.select option {
  background: var(--surface-2);
}
.info-edit .btn-small {
  align-self: end;
  justify-self: start;
}
.details {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  border-top: 1px solid var(--border);
}
.details dt,
.details dd {
  padding: 12px 0;
  border-bottom: 1px solid var(--border-soft);
  font-size: 13px;
  min-height: 46px;
  display: flex;
  align-items: center;
}
.details dt {
  color: var(--text-3);
}
.details dd {
  margin: 0;
  gap: 6px;
  min-width: 0;
}
.num {
  font-variant-numeric: tabular-nums;
}
.path {
  font-family: var(--mono);
  font-size: 12px !important;
  color: var(--text-2);
  overflow-wrap: anywhere;
  user-select: text;
}
.muted {
  color: var(--text-3);
}
.warn {
  color: var(--warning);
}
.stats-block {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto 64px;
  padding: 0 40px;
  box-sizing: border-box;
}
</style>
