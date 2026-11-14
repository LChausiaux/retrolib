<script setup>
// Icônes au trait de l'interface V2 (dessinées en SVG, couleur = currentColor).
defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 16 },
  stroke: { type: Number, default: 1.75 }
})
</script>

<template>
  <svg
    aria-hidden="true"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <template v-if="name === 'grid'">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </template>
    <template v-else-if="name === 'list'">
      <line x1="5" y1="7" x2="19" y2="7" />
      <line x1="5" y1="12" x2="19" y2="12" />
      <line x1="5" y1="17" x2="19" y2="17" />
    </template>
    <template v-else-if="name === 'shelf'">
      <rect x="4" y="8" width="5" height="11" rx="1" />
      <rect x="10.5" y="5" width="4" height="14" rx="1" />
      <rect x="16" y="10" width="4.5" height="9" rx="1" />
      <line x1="2.5" y1="21" x2="21.5" y2="21" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.5" y2="16.5" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <polyline points="6 9 12 15 18 9" />
    </template>
    <template v-else-if="name === 'chevron-left'">
      <polyline points="15 18 9 12 15 6" />
    </template>
    <template v-else-if="name === 'play'">
      <polygon points="7 4 20 12 7 20 7 4" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'star'">
      <polygon
        points="12 3.5 14.6 9 20.5 9.6 16 13.6 17.3 19.5 12 16.5 6.7 19.5 8 13.6 3.5 9.6 9.4 9 12 3.5"
      />
    </template>
    <template v-else-if="name === 'star-filled'">
      <polygon
        points="12 3.5 14.6 9 20.5 9.6 16 13.6 17.3 19.5 12 16.5 6.7 19.5 8 13.6 3.5 9.6 9.4 9 12 3.5"
        fill="currentColor"
      />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'stats'">
      <line x1="6" y1="20" x2="6" y2="12" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="9" />
    </template>
    <template v-else-if="name === 'storage'">
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <line x1="7" y1="7.5" x2="7.01" y2="7.5" />
      <line x1="7" y1="16.5" x2="7.01" y2="16.5" />
    </template>
    <template v-else-if="name === 'settings'">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2.5" fill="var(--bg)" />
      <circle cx="15" cy="17" r="2.5" fill="var(--bg)" />
    </template>
    <template v-else-if="name === 'gamepad'">
      <path
        d="M7 8h10a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.3 2.1L13.5 14h-3l-1.2 1.6A3.5 3.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4z"
      />
      <line x1="7.5" y1="10.5" x2="7.5" y2="13.5" />
      <line x1="6" y1="12" x2="9" y2="12" />
      <line x1="16" y1="11" x2="16.01" y2="11" />
      <line x1="17.5" y1="13" x2="17.51" y2="13" />
    </template>
    <template v-else-if="name === 'library'">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <line x1="4" y1="9" x2="20" y2="9" />
    </template>
    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="8" />
      <polyline points="12 8 12 12 15 14" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
      <polyline points="4 3 4 8 9 8" />
      <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
      <polyline points="20 21 20 16 15 16" />
    </template>
    <template v-else-if="name === 'close'">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </template>
    <template v-else-if="name === 'image'">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9" cy="9.5" r="1.5" />
      <polyline points="20 15 15.5 10.5 6 20" />
    </template>
    <template v-else-if="name === 'edit'">
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    </template>
    <template v-else-if="name === 'trash'">
      <polyline points="4 7 20 7" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </template>
  </svg>
</template>
