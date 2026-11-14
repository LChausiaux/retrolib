<script setup>
import { computed, reactive, ref } from 'vue'
import PlatformIcon from './PlatformIcon.vue'

const props = defineProps({
  emulatorStatus: { type: Array, required: true },
  // Filtre choisi depuis la sidebar (même système que le filtre par plateforme des
  // jeux) : vide = toutes les plateformes, sinon une seule.
  platformFilter: { type: String, default: '' }
})

const emit = defineEmits([
  'set-preference',
  'open',
  'open-folder',
  'choose-path',
  'clear-path',
  'set-launch-options'
])

// État de la vérification de mise à jour (bouton, jamais automatique) : purement
// local à l'affichage, pas besoin de remonter au parent ni de persister. La source
// (GitHub, tags, endpoint JSON custom...) est déterminée côté main process d'après le
// nom de l'émulateur (voir emulator-updates.js) — rien à configurer ici.
const updateChecks = reactive({})

function extractNumbers(str) {
  return [...String(str).matchAll(/\d+/g)].map((m) => parseInt(m[0], 10))
}

// Compare "en gros" une version installée (FileVersion à 4 chiffres, ex. 0.1.245.0) à
// un tag GitHub (format libre : "v8.1", "1.7.0-rc1", un hash court...). Impossible de
// garantir un vrai calcul "plus récent que" vu la diversité des formats — on se
// contente de comparer les 3 premiers groupes de chiffres trouvés dans chaque chaîne :
// true = semblent identiques, false = semblent différentes, null = pas assez d'info.
function versionsLookEqual(installed, tag) {
  const a = extractNumbers(installed)
  const b = extractNumbers(tag)
  const len = Math.min(a.length, b.length, 3)
  if (len === 0) return null
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// Certains émulateurs (DuckStation en tête) ne publient pas de version numérotée :
// une seule release GitHub perpétuellement republiée sous un tag littéral "latest".
// Dans ce cas, comparer les numéros n'a aucun sens — on affiche la date de
// publication de cette build à la place (voir template).
function hasVersionNumber(tag) {
  return extractNumbers(tag).length > 0
}

// Beaucoup de builds ne maintiennent QUE la chaîne "FileVersion" affichée par Windows
// (celle qu'on veut) et laissent le champ numérique VS_FIXEDFILEINFO à une valeur par
// défaut, souvent 1.0.0.0 (vu en pratique sur Flycast : "2.4" en vrai, "1.0.0.0" dans
// le champ numérique) — on préfère donc la chaîne quand elle existe.
function displayVersion(installedVersion) {
  if (!installedVersion) return null
  return installedVersion.fileVersionString || installedVersion.fileVersion
}

function formatDate(isoString) {
  if (!isoString) return null
  return new Date(isoString).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

// Représente l'émulateur effectivement utilisé pour une plateforme (celui retenu par
// activeName/activePath, détection auto ou chemin personnalisé) sous la même forme
// qu'un candidat de la liste détaillée (entry.detected) — permet de réutiliser les
// mêmes fonctions (version, check de mise à jour...) dans les deux cas.
function activeCandidate(entry) {
  if (!entry.activePath) return null
  return {
    name: entry.activeName,
    path: entry.activePath,
    installedVersion: entry.installedVersion,
    versionPending: entry.versionPending,
    hasUpdateCheck: entry.hasUpdateCheck
  }
}

// true seulement quand on SAIT qu'une version plus récente existe (comparaison
// numérique concluante, voir versionsLookEqual) : jamais affiché sur une simple
// supposition (version glissante, pas assez de chiffres communs...). Prend un objet
// "candidat" (voir activeCandidate ci-dessus, ou un élément de entry.detected) plutôt
// qu'une entrée de plateforme, pour marcher aussi bien sur l'émulateur actif que sur
// n'importe quel autre émulateur détecté pour la même plateforme.
function hasKnownUpdate(candidate) {
  if (!candidate) return false
  const check = updateChecks[candidate.name]
  if (!check?.result || !hasVersionNumber(check.result.latestVersion)) return false
  return (
    versionsLookEqual(displayVersion(candidate.installedVersion), check.result.latestVersion) ===
    false
  )
}

// Pastille + libellé de statut d'une ligne : "non installé" (gris), "mise à jour
// dispo" (orange, seulement après un check concluant), sinon "prêt" (vert). Basé sur
// l'émulateur actif de la plateforme — les autres émulateurs détectés ont leur propre
// statut affiché sur son propre bloc quand la plateforme a plusieurs émulateurs
// (voir .console-group).
function statusInfo(entry) {
  if (!entry.launchable) return { text: 'non installé', cls: 'ko' }
  if (hasKnownUpdate(activeCandidate(entry))) return { text: 'mise à jour dispo', cls: 'update' }
  return { text: 'prêt', cls: 'ok' }
}

// Détails complémentaires en tooltip sur la pastille de statut (erreur de
// vérification, ou note "version glissante") : pas la place de les afficher en
// clair sur une ligne aussi compacte, mais l'info reste accessible au survol.
function statusTitle(entry) {
  const candidate = activeCandidate(entry)
  if (!candidate) return ''
  const check = updateChecks[candidate.name]
  if (check?.error) return check.error
  if (check?.result && !hasVersionNumber(check.result.latestVersion)) {
    return `Version glissante — dernière build publiée le ${formatDate(check.result.publishedAt)}`
  }
  return ''
}

// Version affichée sur la ligne : "1.62.3 → 1.63" si une mise à jour est
// disponible et confirmée, sinon juste la version installée (ou "version
// inconnue" si l'exe n'en expose aucune, ex. RPCS3). Prend un candidat (voir
// activeCandidate) pour s'utiliser aussi bien sur l'émulateur actif que sur chaque
// ligne de la sous-liste des émulateurs détectés.
// "lecture de la version…" tant que la lecture en arrière-plan n'est pas finie (voir
// App.vue: loadEmulatorVersions).
function versionLabel(candidate) {
  if (!candidate) return 'version inconnue'
  if (candidate.versionPending) return 'lecture de la version…'
  const installed = candidate.installedVersion ? displayVersion(candidate.installedVersion) : null
  if (hasKnownUpdate(candidate)) {
    return `${installed} → ${updateChecks[candidate.name].result.latestVersion}`
  }
  return installed || 'version inconnue'
}

// Réduit un chemin complet aux 3 derniers segments (ex.
// "emulators\duckstation\duckstation-qt.exe") : le chemin complet n'apporte rien
// de plus sur une ligne aussi compacte, voir aussi .row-subtitle en CSS.
function shortPath(path) {
  if (!path) return ''
  const parts = String(path).split(/[\\/]/).filter(Boolean)
  return parts.slice(-3).join('\\')
}

function gameCountLabel(entry) {
  const n = entry.gameCount || 0
  const label = `${n} jeu${n > 1 ? 'x' : ''}`
  return entry.launchable ? label : `${label} en attente`
}

async function checkUpdateFor(candidate) {
  if (!candidate?.hasUpdateCheck) return
  updateChecks[candidate.name] = { loading: true, error: null, result: null }
  try {
    const result = await window.api.checkEmulatorUpdate(candidate.name)
    updateChecks[candidate.name] = { loading: false, error: null, result }
  } catch (err) {
    updateChecks[candidate.name] = {
      loading: false,
      error: err.message || String(err),
      result: null
    }
  }
}

// Tous les émulateurs candidats, toutes plateformes confondues, dédupliqués par nom
// (un même exécutable peut être un candidat détecté sur une plateforme et l'émulateur
// actif via un chemin personnalisé sur une autre) — sert de base au bouton "Tout
// vérifier" et à son compteur, indépendamment du filtre en cours.
const allCandidates = computed(() => {
  const byName = new Map()
  for (const entry of props.emulatorStatus) {
    for (const candidate of entry.detected) {
      if (!byName.has(candidate.name)) byName.set(candidate.name, candidate)
    }
    const active = activeCandidate(entry)
    if (active && !byName.has(active.name)) byName.set(active.name, active)
  }
  return [...byName.values()]
})

const checkableCount = computed(() => allCandidates.value.filter((c) => c.hasUpdateCheck).length)

const checkingAll = ref(false)

// Vérifie tous les émulateurs d'un coup (toutes plateformes, pas seulement celles
// affichées par le filtre en cours) plutôt que de cliquer un par un. En parallèle :
// ce sont des requêtes indépendantes, pas de raison de les faire en série.
async function checkAllUpdates() {
  if (checkingAll.value) return
  checkingAll.value = true
  try {
    const targets = allCandidates.value.filter((c) => c.hasUpdateCheck)
    await Promise.all(targets.map((candidate) => checkUpdateFor(candidate)))
  } finally {
    checkingAll.value = false
  }
}

const visibleStatus = computed(() =>
  props.platformFilter
    ? props.emulatorStatus.filter((e) => e.platform === props.platformFilter)
    : props.emulatorStatus
)

// Liste à plat, triée par ordre alphabétique classique du nom de la console — pas de
// regroupement par éditeur/famille (Nintendo, PlayStation...), qui n'apporte rien ici
// et complique la lecture d'une liste qu'on veut pouvoir parcourir simplement.
const sortedStatus = computed(() =>
  [...visibleStatus.value].sort((a, b) => a.label.localeCompare(b.label, 'fr'))
)

// Résumé global affiché sous le titre de la page (toujours sur l'ensemble filtré,
// comme les compteurs par famille juste en dessous).
const totalCount = computed(() => visibleStatus.value.length)
const readyCount = computed(() => visibleStatus.value.filter((e) => e.launchable).length)
const updatesAvailableCount = computed(
  () => visibleStatus.value.filter((e) => hasKnownUpdate(activeCandidate(e))).length
)
const headerSubtitle = computed(() => {
  const ready = readyCount.value
  const parts = [
    `${ready} émulateur${ready > 1 ? 's' : ''} prêt${ready > 1 ? 's' : ''} sur ${totalCount.value}`
  ]
  const updates = updatesAvailableCount.value
  if (updates > 0) {
    parts.push(
      `${updates} mise${updates > 1 ? 's' : ''} à jour disponible${updates > 1 ? 's' : ''}`
    )
  }
  return parts.join(' · ')
})

// Choix direct d'un émulateur candidat en cliquant sur son bloc (voir plus bas, cas
// "plusieurs émulateurs détectés") — remplace l'ancien <select> du menu ⋮.
function selectPreference(platform, name) {
  emit('set-preference', platform, name)
}

// Ordre d'affichage des lignes d'émulateur pour une plateforme : l'actif d'abord,
// puis les autres par ordre alphabétique classique — jamais par éditeur/famille, qui
// n'a rien à voir avec le choix d'un émulateur précis pour une même console.
function sortedDetected(entry) {
  return [...entry.detected].sort((a, b) => {
    const aActive = a.name === entry.activeName
    const bActive = b.name === entry.activeName
    if (aActive !== bActive) return aActive ? -1 : 1
    return a.name.localeCompare(b.name, 'fr')
  })
}

// Toutes les lignes d'émulateur à afficher pour une plateforme, même présentation
// qu'il y en ait une ou plusieurs : les candidats auto-détectés (sortedDetected
// ci-dessus), précédés au besoin de l'émulateur actif quand il vient d'un chemin
// personnalisé (donc absent de la liste des candidats auto-détectés).
function displayRows(entry) {
  const sorted = sortedDetected(entry)
  const active = activeCandidate(entry)
  if (active && !sorted.some((c) => c.name === active.name)) {
    return [active, ...sorted]
  }
  return sorted
}

// Menu ⋮ par ligne (une seule ouverte à la fois) : regroupe les actions
// secondaires (dossier, vérification, config) qui n'ont plus la place d'avoir
// chacune leur propre bouton sur une ligne aussi compacte. Clé au lieu d'une simple
// plateforme : une plateforme avec plusieurs émulateurs affiche désormais un bloc
// complet par émulateur (voir plus bas), chacun avec son propre menu.
const menuOpenKey = ref(null)

function toggleMenu(key) {
  menuOpenKey.value = menuOpenKey.value === key ? null : key
}

function closeMenu() {
  menuOpenKey.value = null
}

// Exécute une action de menu puis referme le menu — un gestionnaire de clic Vue
// (contrairement à un <script> classique) ne peut pas contenir plusieurs
// instructions séparées par des retours à la ligne sans point-virgule, d'où ce
// petit helper plutôt que d'enchaîner deux appels dans le template.
function runAndCloseMenu(fn) {
  fn()
  closeMenu()
}

// Page de config dédiée (accessible depuis chaque carte) : chemin personnalisé +
// arguments de lancement personnalisés. On garde juste la plateforme en cours de
// config (pas une copie de l'entrée) et on la recherche à chaque rendu dans
// emulatorStatus, pour rester à jour après un rechargement de la bibliothèque
// (ex: juste après avoir enregistré un changement ici).
const configuringPlatform = ref(null)
const configuringEntry = computed(
  () => props.emulatorStatus.find((e) => e.platform === configuringPlatform.value) || null
)
const launchArgsInput = ref('')
const standaloneArgsInput = ref('')

function openConfig(entry) {
  configuringPlatform.value = entry.platform
  launchArgsInput.value = entry.launchArgs || ''
  standaloneArgsInput.value = entry.standaloneArgs || ''
}

function closeConfig() {
  configuringPlatform.value = null
}

// Sauvegarde à la volée (au blur/Entrée, pas à chaque frappe) : on n'envoie que le
// champ modifié, setEmulatorLaunchOptions (voir config.js côté main) conserve
// l'autre valeur déjà enregistrée.
function saveLaunchArgs() {
  emit('set-launch-options', configuringEntry.value.platform, {
    launchArgs: launchArgsInput.value
  })
}

function saveStandaloneArgs() {
  emit('set-launch-options', configuringEntry.value.platform, {
    standaloneArgs: standaloneArgsInput.value
  })
}
</script>

<template>
  <div class="emulators-page">
    <template v-if="configuringEntry">
      <button class="back-link" @click="closeConfig">← Retour aux émulateurs</button>
      <h2 class="config-title">Configurer {{ configuringEntry.label }}</h2>

      <section class="config-section">
        <h3>Chemin personnalisé</h3>
        <p class="config-hint">
          Remplace la détection automatique — utile si l'émulateur est installé ailleurs que dans le
          dossier RomStation, ou si la détection se trompe.
        </p>
        <div class="row">
          <span v-if="configuringEntry.overridePath" class="override-path">
            {{ configuringEntry.overridePath }}
          </span>
          <span v-else class="override-path empty">aucun (détection automatique)</span>
          <button class="link-button" @click="emit('choose-path', configuringEntry.platform)">
            Parcourir…
          </button>
          <button
            v-if="configuringEntry.overridePath"
            class="link-button"
            @click="emit('clear-path', configuringEntry.platform)"
          >
            Réinitialiser
          </button>
        </div>
      </section>

      <section class="config-section">
        <h3>Arguments de lancement</h3>
        <p class="config-hint">
          Ajoutés à la ligne de commande quand un jeu est lancé avec cet émulateur. Le chemin de la
          rom est ajouté automatiquement à la fin, sauf si <code>{rom}</code> apparaît quelque part
          dans les arguments (il est alors remplacé à cet endroit précis).
        </p>
        <input
          v-model="launchArgsInput"
          type="text"
          class="config-input"
          placeholder="ex : -batch -fullscreen"
          @change="saveLaunchArgs"
        />
      </section>

      <section class="config-section">
        <h3>Arguments pour « Ouvrir l'émulateur seul »</h3>
        <p class="config-hint">
          Utilisés uniquement par le bouton "Ouvrir l'émulateur" (sans jeu) — utile pour des flags
          comme --big-picture ou --portable.
        </p>
        <input
          v-model="standaloneArgsInput"
          type="text"
          class="config-input"
          placeholder="ex : --big-picture"
          @change="saveStandaloneArgs"
        />
      </section>
    </template>

    <template v-else>
      <div class="page-header">
        <div>
          <h1>Émulateurs</h1>
          <p class="page-subtitle">{{ headerSubtitle }}</p>
        </div>
        <button
          class="btn btn-outline"
          :disabled="checkingAll || checkableCount === 0"
          :title="checkableCount === 0 ? 'Aucun émulateur avec vérification disponible' : ''"
          @click="checkAllUpdates"
        >
          {{ checkingAll ? '⟳ Vérification…' : '⟳ Tout vérifier' }}
        </button>
      </div>
      <p class="intro">
        Un émulateur par plateforme. RetroLib détecte automatiquement ceux installés via RomStation
        (dossier <code>app/emulators/downloads</code>) ; tu peux aussi indiquer un chemin
        personnalisé si la détection se trompe ou si l'émulateur est installé ailleurs.
      </p>

      <div class="platform-list">
        <div v-for="entry in sortedStatus" :key="entry.platform" class="console-group">
          <!-- Même présentation pour toutes les plateformes, qu'il y ait un seul
          émulateur détecté ou plusieurs : le nom de la console en en-tête, puis la
          liste de ses émulateurs en dessous (jamais un bloc "console" isolé pour le
          cas à un seul émulateur). -->
          <div class="console-subheader">
            <div class="console-subheader-title">
              <PlatformIcon :platform="entry.platform" :size="18" />
              <span class="console-subheader-label">{{ entry.label }}</span>
            </div>
            <span class="console-subheader-count">{{ gameCountLabel(entry) }}</span>
          </div>

          <!-- Aucun émulateur détecté et aucun chemin personnalisé : une ligne neutre
          plutôt que rien, pour rester cohérent avec le reste de la liste. -->
          <div v-if="displayRows(entry).length === 0" class="platform-row">
            <div class="row-top">
              <div class="row-main">
                <div class="row-title">
                  <span class="status-dot ko"></span>
                  <span class="status-text ko">non installé</span>
                </div>
                <p class="row-subtitle">Aucun exécutable détecté</p>
              </div>

              <div class="row-side">
                <button class="btn btn-outline btn-open" disabled>Ouvrir</button>

                <div class="row-menu">
                  <button class="btn-icon" @click="toggleMenu(entry.platform)">⋮</button>
                  <div
                    v-if="menuOpenKey === entry.platform"
                    class="menu-backdrop"
                    @click="closeMenu"
                  ></div>
                  <div v-if="menuOpenKey === entry.platform" class="menu-dropdown" @click.stop>
                    <button class="menu-item" @click="runAndCloseMenu(() => openConfig(entry))">
                      Configurer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-for="candidate in displayRows(entry)" :key="candidate.name" class="platform-row">
            <div class="row-top">
              <div class="row-main">
                <div class="row-title">
                  <h3>{{ candidate.name }}</h3>
                  <span
                    class="status-dot"
                    :class="candidate.name === entry.activeName ? statusInfo(entry).cls : 'ko'"
                    :title="candidate.name === entry.activeName ? statusTitle(entry) : ''"
                  ></span>
                  <span
                    class="status-text"
                    :class="candidate.name === entry.activeName ? statusInfo(entry).cls : 'ko'"
                  >
                    {{ candidate.name === entry.activeName ? statusInfo(entry).text : 'détecté' }}
                  </span>
                </div>
                <p class="row-subtitle">
                  {{ versionLabel(candidate) }} · {{ shortPath(candidate.path) }}
                </p>
              </div>

              <div class="row-side">
                <template v-if="candidate.name === entry.activeName">
                  <button
                    class="btn btn-outline btn-open"
                    @click="emit('open', entry.activePath, entry.standaloneArgs)"
                  >
                    Ouvrir
                  </button>
                </template>
                <button
                  v-else
                  class="btn btn-outline btn-open"
                  @click="selectPreference(entry.platform, candidate.name)"
                >
                  Utiliser
                </button>

                <div class="row-menu">
                  <button
                    class="btn-icon"
                    @click="toggleMenu(entry.platform + ':' + candidate.name)"
                  >
                    ⋮
                  </button>
                  <div
                    v-if="menuOpenKey === entry.platform + ':' + candidate.name"
                    class="menu-backdrop"
                    @click="closeMenu"
                  ></div>
                  <div
                    v-if="menuOpenKey === entry.platform + ':' + candidate.name"
                    class="menu-dropdown"
                    @click.stop
                  >
                    <button
                      class="menu-item"
                      @click="runAndCloseMenu(() => emit('open-folder', candidate.path))"
                    >
                      Ouvrir le dossier
                    </button>
                    <button
                      v-if="candidate.hasUpdateCheck"
                      class="menu-item"
                      :disabled="updateChecks[candidate.name]?.loading"
                      @click="runAndCloseMenu(() => checkUpdateFor(candidate))"
                    >
                      {{
                        updateChecks[candidate.name]?.loading
                          ? 'Vérification…'
                          : 'Vérifier les mises à jour'
                      }}
                    </button>
                    <button class="menu-item" @click="runAndCloseMenu(() => openConfig(entry))">
                      Configurer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.emulators-page {
  padding: 28px;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
}
.back-link {
  background: transparent;
  border: none;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
  font-size: 0.85rem;
  padding: 4px 0 20px;
}
.back-link:hover {
  opacity: 1;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 26px;
}
h1 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
}
.page-subtitle {
  margin: 6px 0 0;
  font-size: 0.85rem;
  opacity: 0.55;
}
.intro {
  margin: 0 0 24px;
  font-size: 0.82rem;
  opacity: 0.65;
  max-width: 720px;
  line-height: 1.5;
}
.intro code {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 5px;
  border-radius: 4px;
}
.platform-list {
  display: flex;
  flex-direction: column;
  max-width: 820px;
}
.platform-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.platform-row:last-child {
  border-bottom: none;
}
.row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.row-main {
  min-width: 0;
  flex: 1;
}
.row-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.row-title h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.ok {
  background: #7bdc9a;
}
.status-dot.ko {
  background: rgba(255, 255, 255, 0.3);
}
.status-dot.update {
  background: #e0a030;
}
.status-text {
  font-size: 0.78rem;
}
.status-text.ok {
  color: #7bdc9a;
}
.status-text.ko {
  color: rgba(255, 255, 255, 0.5);
}
.status-text.update {
  color: #e0a030;
}
.row-subtitle {
  margin: 4px 0 0;
  font-size: 0.78rem;
  opacity: 0.5;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-side {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}
.console-group {
  margin: 4px 0;
  padding: 4px 12px 6px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
}
.console-subheader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0 6px;
}
.console-subheader-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.console-subheader-label {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.5;
}
.console-subheader-count {
  font-size: 0.68rem;
  opacity: 0.4;
}
.console-group .platform-row {
  padding: 10px 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  margin: 8px 0;
  flex-wrap: wrap;
}
.link-button {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 5px;
  padding: 3px 9px;
  font-size: 0.72rem;
  cursor: pointer;
  color: inherit;
}
.link-button:hover {
  background: rgba(255, 255, 255, 0.06);
}
.btn {
  border-radius: 8px;
  padding: 9px 16px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  flex-shrink: 0;
}
.btn-outline {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.18);
  color: inherit;
}
.btn-outline:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}
.btn-outline:disabled {
  opacity: 0.4;
  cursor: default;
}
.btn-open {
  padding: 6px 16px;
  font-size: 0.8rem;
}
.btn-icon {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  width: 32px;
  height: 32px;
  color: inherit;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
.btn-icon:hover {
  background: rgba(255, 255, 255, 0.06);
}
.row-menu {
  position: relative;
}
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}
.menu-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: #24242b;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 6px;
  min-width: 230px;
  z-index: 21;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.menu-item {
  background: transparent;
  border: none;
  color: inherit;
  text-align: left;
  padding: 8px 10px;
  border-radius: 5px;
  font-size: 0.82rem;
  cursor: pointer;
}
.menu-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}
.menu-item:disabled {
  opacity: 0.4;
  cursor: default;
}
.config-title {
  margin: 0 0 20px;
  font-size: 1.2rem;
}
.config-section {
  max-width: 640px;
  margin-bottom: 24px;
}
.config-section h3 {
  margin: 0 0 6px;
  font-size: 0.9rem;
}
.config-hint {
  margin: 0 0 10px;
  font-size: 0.78rem;
  opacity: 0.6;
  line-height: 1.5;
}
.config-hint code {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 5px;
  border-radius: 4px;
}
.config-input {
  width: 100%;
  box-sizing: border-box;
  background: #24242b;
  color: #f0f0f0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 5px;
  padding: 7px 10px;
  font-size: 0.85rem;
  font-family: monospace;
}
.override-path {
  font-family: monospace;
  font-size: 0.78rem;
  opacity: 0.9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
}
.override-path.empty {
  font-family: inherit;
  opacity: 0.5;
  font-style: italic;
}
</style>
