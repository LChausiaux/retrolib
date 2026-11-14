<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { formatFor, getThumbModel, queueSnapshot, renderSnapshot } from '../box3d'

// Tuile de la vue étagère : la boîte 3D du jeu, rendue par le renderer WebGL partagé
// (box3d.js) dans un simple canvas 2D. Au survol, la boîte suit la souris (rendu image
// par image tant qu'elle bouge), puis revient à sa pose de repos.
const props = defineProps({
  game: { type: Object, required: true },
  platformLabel: { type: String, default: '' },
  // Pixels par millimètre : même valeur pour toutes les tuiles, pour que chaque boîte
  // garde ses proportions réelles par rapport aux autres.
  pxPerMm: { type: Number, default: 1.15 },
  tilt: { type: Number, default: 22 },
  // Tuile focalisée au clavier / à la manette : petite rotation pour la signaler.
  active: { type: Boolean, default: false }
})

const REST = { rx: 6, ry: 26 }

// Format par défaut de la console, puis format réel (proportions de la jaquette,
// épaisseur de la tranche) une fois la boîte construite.
const modelFmt = ref(null)
const fmt = computed(() => modelFmt.value || formatFor(props.game))
const margin = computed(() => Math.round(14 * props.pxPerMm))
// Taille CSS du canvas : la boîte + son épaisseur (vue de trois quarts) + marges.
const cssWidth = computed(() =>
  Math.round((fmt.value.w + fmt.value.d) * props.pxPerMm + margin.value * 2)
)
const cssHeight = computed(() => Math.round(fmt.value.h * props.pxPerMm + margin.value * 2))

const canvas = ref(null)
const root = ref(null)
const ready = ref(false)
const hovered = ref(false)

let model = null
let pose = { ...REST }
let target = { ...REST }
let frame = 0
let observer = null
let disposed = false

function dpr() {
  return Math.min(window.devicePixelRatio || 1, 2)
}

function draw() {
  if (!model || !canvas.value) return
  const ratio = dpr()
  const el = canvas.value
  const width = Math.round(cssWidth.value * ratio)
  const height = Math.round(cssHeight.value * ratio)
  if (el.width !== width || el.height !== height) {
    el.width = width
    el.height = height
  }
  renderSnapshot(model, el, {
    rx: pose.rx,
    ry: pose.ry,
    pxPerMm: props.pxPerMm * ratio,
    bottom: margin.value * ratio
  })
}

async function ensureModel() {
  if (model) return model
  model = await getThumbModel(props.game, props.platformLabel)
  modelFmt.value = model.fmt
  return model
}

async function firstRender() {
  await queueSnapshot(async () => {
    if (disposed) return
    await ensureModel()
    if (disposed) return
    draw()
    ready.value = true
  })
}

function animate() {
  frame = 0
  pose.rx += (target.rx - pose.rx) * 0.25
  pose.ry += (target.ry - pose.ry) * 0.25
  draw()
  if (Math.abs(target.rx - pose.rx) > 0.05 || Math.abs(target.ry - pose.ry) > 0.05) {
    frame = requestAnimationFrame(animate)
  }
}

function setTarget(next) {
  target = next
  if (!frame && model) frame = requestAnimationFrame(animate)
}

async function onPointerMove(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const mx = ((event.clientX - rect.left) / rect.width) * 2 - 1
  const my = ((event.clientY - rect.top) / rect.height) * 2 - 1
  hovered.value = true
  await ensureModel()
  setTarget({ rx: REST.rx + my * props.tilt * 0.45, ry: REST.ry + mx * props.tilt })
}

function onPointerLeave() {
  hovered.value = false
  setTarget({ ...REST })
}

watch(
  () => props.active,
  async (active) => {
    hovered.value = active
    if (!active) return setTarget({ ...REST })
    await ensureModel()
    setTarget({ rx: REST.rx + 2, ry: REST.ry + 12 })
  }
)

watch(
  () => [
    props.game.coverUrl,
    props.game.backCoverUrl,
    props.game.spineCoverUrl,
    props.game.title,
    props.pxPerMm
  ],
  async () => {
    model = null
    if (!ready.value) return
    await ensureModel()
    draw()
  }
)

onMounted(() => {
  // Rendu au moment où la tuile approche de la zone visible seulement.
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect()
        observer = null
        firstRender()
      }
    },
    { rootMargin: '400px 0px' }
  )
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  cancelAnimationFrame(frame)
  // Le modèle reste dans le cache partagé (box3d.js), qui se charge de le libérer.
  model = null
})
</script>

<template>
  <div
    ref="root"
    class="box3d"
    :class="{ hovered }"
    :style="{ width: cssWidth + 'px', height: cssHeight + 'px' }"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
    <div
      class="shadow"
      aria-hidden="true"
      :style="{
        left: margin + 'px',
        width: fmt.w * pxPerMm + fmt.d * pxPerMm * 0.6 + 'px',
        bottom: margin * 0.35 + 'px',
        height: margin * 1.3 + 'px'
      }"
    ></div>
    <!-- Aperçu de secours tant que la boîte n'est pas rendue (ou sans WebGL). -->
    <div
      v-if="!ready"
      class="fallback"
      aria-hidden="true"
      :style="{
        left: margin + fmt.d * pxPerMm * 0.5 + 'px',
        bottom: margin + 'px',
        width: fmt.w * pxPerMm + 'px',
        height: fmt.h * pxPerMm + 'px'
      }"
    >
      <img v-if="game.coverUrl" :src="game.coverUrl" alt="" loading="lazy" />
    </div>
    <canvas
      ref="canvas"
      class="canvas"
      :style="{ width: cssWidth + 'px', height: cssHeight + 'px' }"
    ></canvas>
  </div>
</template>

<style scoped>
.box3d {
  position: relative;
  flex: none;
  transition: transform 0.35s ease;
}
.box3d.hovered {
  transform: translateY(-8px);
}
.canvas {
  position: absolute;
  inset: 0;
}
.shadow {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0) 70%);
  transition:
    transform 0.35s ease,
    opacity 0.35s ease;
}
.box3d.hovered .shadow {
  transform: translateY(8px) scale(0.88);
  opacity: 0.55;
}
.fallback {
  position: absolute;
  border-radius: 3px;
  overflow: hidden;
  background: var(--surface-3);
}
.fallback img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
