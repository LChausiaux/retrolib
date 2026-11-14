<script setup>
import { computed } from 'vue'
import { iconTypeFor, colorFor } from '../platform-icons'

const props = defineProps({
  platform: { type: String, required: true },
  size: { type: Number, default: 20 }
})

// Icônes officielles des consoles, reprises du dossier app/images/systems/ de
// RomStation (déjà installées sur la machine) et renommées par plateforme dans
// assets/systems/ (voir la conversation : copie locale, usage strictement personnel,
// jamais redistribué). import.meta.glob charge tous les PNG une fois pour toutes,
// puis on pioche dedans par plateforme.
const modules = import.meta.glob('../assets/systems/*.png', { eager: true, import: 'default' })
const icons = Object.fromEntries(
  Object.entries(modules).map(([path, url]) => [path.match(/([^/]+)\.png$/)[1], url])
)

const type = computed(() => iconTypeFor(props.platform))
const color = computed(() => colorFor(props.platform))
const iconSrc = computed(() => icons[props.platform] || null)
// Fond de la pastille en version très transparente de la couleur d'accent (même
// principe que les badges de statut existants, ex. .status-dot).
const background = computed(() => `${color.value}26`)
</script>

<template>
  <span
    class="platform-icon"
    :style="{ width: size + 'px', height: size + 'px', background, color }"
  >
    <img v-if="iconSrc" :src="iconSrc" :alt="platform" class="platform-icon-img" />
    <!-- Filet de sécurité : une plateforme sans icône RomStation correspondante
    (ex. ajoutée plus tard) retombe sur un pictogramme générique maison. -->
    <svg
      v-else
      viewBox="0 0 24 24"
      width="62%"
      height="62%"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <template v-if="type === 'handheld'">
        <rect x="6" y="2" width="12" height="20" rx="2.5" />
        <rect x="8.5" y="5" width="7" height="6" rx="1" />
        <circle cx="9.5" cy="16" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="16" r="1" fill="currentColor" stroke="none" />
      </template>
      <template v-else-if="type === 'disc'">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="2.6" />
      </template>
      <template v-else-if="type === 'cartridge'">
        <path d="M7 3h6l4 4v14H7z" />
        <path d="M7 9h10" />
      </template>
      <template v-else-if="type === 'hybrid'">
        <rect x="3.5" y="7" width="4" height="10" rx="1.5" />
        <rect x="16.5" y="7" width="4" height="10" rx="1.5" />
        <rect x="8" y="6" width="8" height="12" rx="1.5" />
      </template>
    </svg>
  </span>
</template>

<style scoped>
.platform-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  flex-shrink: 0;
  overflow: hidden;
}
.platform-icon-img {
  width: 75%;
  height: 75%;
  object-fit: contain;
  /* Icônes sources en 16x16 (voir app/images/systems/ de RomStation) : on garde le
  rendu pixellisé plutôt qu'un flou d'upscale, cohérent avec l'esthétique rétro. */
  image-rendering: pixelated;
}
</style>
