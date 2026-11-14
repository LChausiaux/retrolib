<script setup>
import { computed } from 'vue'
import PlatformIcon from './PlatformIcon.vue'
import AppIcon from './AppIcon.vue'
import { orderByFamily } from '../platform-families'

// Barre latérale : filtres de la bibliothèque (plateformes rangées par constructeur,
// favoris, récents), période de la page Stats, plateformes de la page Émulateurs, et
// en pied les sections de l'appli.
const props = defineProps({
  mode: { type: String, required: true }, // 'games' | 'emulators' | 'stats' | 'storage'
  games: { type: Array, required: true },
  platformFilter: { type: String, default: '' },
  platformCatalog: { type: Object, required: true },
  statsPeriod: { type: String, default: 'all' },
  statsPeriods: { type: Array, required: true },
  emulatorStatus: { type: Array, default: () => [] },
  emulatorPlatformFilter: { type: String, default: '' }
})

const emit = defineEmits([
  'select-platform',
  'select-mode',
  'update:statsPeriod',
  'select-emulator-platform',
  'open-settings'
])

const BRANDS = [
  { name: 'Sony', platforms: ['ps1', 'ps2', 'ps3', 'psp'] },
  {
    name: 'Nintendo',
    platforms: [
      'snes',
      'n64',
      'gamecube',
      'wii',
      'wiiu',
      'switch',
      'gb',
      'gbc',
      'gba',
      'nds',
      '3ds'
    ]
  },
  { name: 'Sega', platforms: ['saturn', 'dreamcast'] },
  { name: 'Microsoft', platforms: ['xbox360'] }
]

// Plateformes présentes dans la bibliothèque avec leur nombre de jeux, rangées par
// constructeur.
const platformGroups = computed(() => {
  const counts = new Map()
  for (const game of props.games) {
    if (game.platform) counts.set(game.platform, (counts.get(game.platform) || 0) + 1)
  }
  const options = [...counts.entries()]
    .map(([platform, count]) => ({
      value: platform,
      label: props.platformCatalog.labels[platform] || platform,
      count
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  const byValue = new Map(options.map((opt) => [opt.value, opt]))
  const used = new Set()
  const groups = BRANDS.map((brand) => ({
    name: brand.name,
    items: brand.platforms
      .filter((p) => byValue.has(p))
      .map((p) => {
        used.add(p)
        return byValue.get(p)
      })
  })).filter((group) => group.items.length)
  const others = options.filter((opt) => !used.has(opt.value))
  if (others.length) groups.push({ name: 'Autres', items: others })
  return groups
})

const favoriteCount = computed(() => props.games.filter((g) => g.favorite).length)
const recentCount = computed(() => props.games.filter((g) => g.lastPlayed).length)
const unknownCount = computed(() => props.games.filter((g) => !g.platform).length)

// Toutes les plateformes connues (pas seulement celles de la bibliothèque), rangées par
// famille de console comme sur la page Émulateurs.
const emulatorPlatformOptions = computed(() =>
  orderByFamily(
    props.emulatorStatus.map((entry) => ({
      value: entry.platform,
      label: entry.label,
      ok: entry.launchable
    }))
  )
)

const FOOTER = [
  { mode: 'games', icon: 'library', label: 'Bibliothèque' },
  { mode: 'emulators', icon: 'gamepad', label: 'Émulateurs' },
  { mode: 'stats', icon: 'stats', label: 'Statistiques' },
  { mode: 'storage', icon: 'storage', label: 'Stockage' }
]
</script>

<template>
  <nav class="sidebar" aria-label="Navigation" data-nav-region="sidebar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"><AppIcon name="play" :size="11" /></span>
      <span>RetroLib</span>
    </div>

    <div class="nav-scroll">
      <template v-if="mode === 'games'">
        <div class="nav-group">
          <button
            type="button"
            data-nav-tab
            class="nav-item"
            :class="{ active: platformFilter === '' }"
            @click="emit('select-platform', '')"
          >
            <span class="nav-label">Tous les jeux</span>
            <span class="nav-count">{{ games.length }}</span>
          </button>
          <button
            v-if="favoriteCount"
            type="button"
            data-nav-tab
            class="nav-item"
            :class="{ active: platformFilter === '__favorites__' }"
            @click="emit('select-platform', '__favorites__')"
          >
            <span class="nav-label">Favoris</span>
            <span class="nav-count">{{ favoriteCount }}</span>
          </button>
          <button
            v-if="recentCount"
            type="button"
            data-nav-tab
            class="nav-item"
            :class="{ active: platformFilter === '__recent__' }"
            @click="emit('select-platform', '__recent__')"
          >
            <span class="nav-label">Récemment joués</span>
            <span class="nav-count">{{ recentCount }}</span>
          </button>
        </div>

        <div v-for="group in platformGroups" :key="group.name" class="nav-group">
          <div class="nav-heading">{{ group.name }}</div>
          <button
            v-for="opt in group.items"
            :key="opt.value"
            type="button"
            data-nav-tab
            class="nav-item"
            :class="{ active: platformFilter === opt.value }"
            @click="emit('select-platform', opt.value)"
          >
            <span class="nav-label-wrap">
              <PlatformIcon :platform="opt.value" :size="16" />
              <span class="nav-label">{{ opt.label }}</span>
            </span>
            <span class="nav-count">{{ opt.count }}</span>
          </button>
        </div>

        <div v-if="unknownCount" class="nav-group">
          <div class="nav-heading">Autres</div>
          <button
            type="button"
            data-nav-tab
            class="nav-item"
            :class="{ active: platformFilter === '__unknown__' }"
            @click="emit('select-platform', '__unknown__')"
          >
            <span class="nav-label">Plateforme inconnue</span>
            <span class="nav-count">{{ unknownCount }}</span>
          </button>
        </div>
      </template>

      <div v-else-if="mode === 'stats'" class="nav-group">
        <div class="nav-heading">Période</div>
        <button
          v-for="period in statsPeriods"
          :key="period.value"
          type="button"
          data-nav-tab
          class="nav-item"
          :class="{ active: statsPeriod === period.value }"
          @click="emit('update:statsPeriod', period.value)"
        >
          <span class="nav-label">{{ period.label }}</span>
        </button>
      </div>

      <div v-else-if="mode === 'emulators'" class="nav-group">
        <button
          type="button"
          data-nav-tab
          class="nav-item"
          :class="{ active: emulatorPlatformFilter === '' }"
          @click="emit('select-emulator-platform', '')"
        >
          <span class="nav-label">Tous les émulateurs</span>
        </button>
        <button
          v-for="opt in emulatorPlatformOptions"
          :key="opt.value"
          type="button"
          data-nav-tab
          class="nav-item"
          :class="{ active: emulatorPlatformFilter === opt.value }"
          @click="emit('select-emulator-platform', opt.value)"
        >
          <span class="nav-label-wrap">
            <PlatformIcon :platform="opt.value" :size="16" />
            <span class="nav-label">{{ opt.label }}</span>
          </span>
          <span
            class="status-dot"
            :class="{ ok: opt.ok }"
            :title="opt.ok ? 'Prêt' : 'Émulateur absent'"
          ></span>
        </button>
      </div>
    </div>

    <div class="nav-footer">
      <button
        v-for="item in FOOTER"
        :key="item.mode"
        type="button"
        class="nav-item footer-item"
        data-nav-mode
        :class="{ active: mode === item.mode }"
        @click="emit('select-mode', item.mode)"
      >
        <span class="nav-label-wrap"><AppIcon :name="item.icon" />{{ item.label }}</span>
      </button>
      <button type="button" class="nav-item footer-item" @click="emit('open-settings')">
        <span class="nav-label-wrap"><AppIcon name="settings" />Réglages</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  flex: 0 0 232px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 12px 16px;
  border-right: 1px solid var(--border);
  min-height: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
}
.brand-mark {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--text);
  color: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 1px;
}
.nav-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin: 0 -4px;
  padding: 4px;
}
.nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-heading {
  padding: 0 10px 6px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
}
.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  flex: none;
}
.nav-item:hover {
  background: var(--surface-2);
}
.nav-item.active {
  background: var(--surface-3);
  color: var(--text-strong);
  font-weight: 500;
}
.nav-label-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.nav-count {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8a3a3a;
  flex: none;
}
.status-dot.ok {
  background: var(--live);
}
.nav-footer {
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.footer-item {
  height: 34px;
}
</style>
