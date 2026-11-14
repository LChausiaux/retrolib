<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { buildBoxModel, createViewerRenderer } from '../box3d'

// Boîte 3D de la fiche du jeu : se fait tourner à la souris (glisser), avec inertie,
// et s'oriente sur la face, la tranche ou le dos via la prop "view".
const props = defineProps({
  game: { type: Object, required: true },
  platformLabel: { type: String, default: '' },
  view: { type: String, default: 'face' }, // 'face' | 'tranche' | 'dos'
  // Change à chaque clic sur un bouton d'orientation, même déjà sélectionné : la
  // boîte revient alors sur cette vue après avoir été tournée à la main.
  viewKey: { type: Number, default: 0 }
})

const VIEWS = { face: 20, tranche: 78, dos: 200 }

const host = ref(null)
const canvas = ref(null)
const failed = ref(false)
const dragging = ref(false)

let viewer = null
let model = null
let buildToken = 0
let frame = 0
let resizeObserver = null
let size = { width: 0, height: 0 }
let pose = { rx: 8, ry: VIEWS.face }
let target = { rx: 8, ry: VIEWS.face }
let velocity = 0
let last = null

function scheduleFrame() {
  if (!frame) frame = requestAnimationFrame(tick)
}

function tick() {
  frame = 0
  if (!viewer || !model || !size.width) return
  if (!dragging.value) {
    if (Math.abs(velocity) > 0.02) {
      target.ry += velocity
      velocity *= 0.92
    }
    pose.rx += (target.rx - pose.rx) * 0.14
    pose.ry += (target.ry - pose.ry) * 0.14
  } else {
    pose = { ...target }
  }
  viewer.render(model, { ...pose, ...size })
  const moving =
    dragging.value ||
    Math.abs(velocity) > 0.02 ||
    Math.abs(target.rx - pose.rx) > 0.03 ||
    Math.abs(target.ry - pose.ry) > 0.03
  if (moving) scheduleFrame()
}

// Ramène la rotation cible au tour le plus proche, pour que le passage à une vue
// prenne le plus court chemin au lieu de dérouler les tours accumulés.
function goTo(view) {
  const wanted = VIEWS[view] ?? VIEWS.face
  const turns = Math.round((pose.ry - wanted) / 360)
  velocity = 0
  target = { rx: 8, ry: wanted + turns * 360 }
  scheduleFrame()
}

async function rebuild() {
  const token = ++buildToken
  try {
    const next = await buildBoxModel(props.game, {
      platformLabel: props.platformLabel,
      quality: 'full',
      renderer: viewer.renderer
    })
    if (token !== buildToken || !viewer) {
      next.dispose()
      return
    }
    if (model) {
      viewer.detach(model)
      model.dispose()
    }
    model = next
    viewer.render(model, { ...pose, ...size })
  } catch {
    failed.value = true
  }
}

function onPointerDown(event) {
  event.currentTarget.setPointerCapture?.(event.pointerId)
  dragging.value = true
  velocity = 0
  last = { x: event.clientX, y: event.clientY, t: performance.now() }
}

function onPointerMove(event) {
  if (!dragging.value || !last) return
  const dx = event.clientX - last.x
  const dy = event.clientY - last.y
  target.ry += dx * 0.5
  target.rx = Math.max(-40, Math.min(40, target.rx + dy * 0.3))
  velocity = dx * 0.5
  last = { x: event.clientX, y: event.clientY, t: performance.now() }
  scheduleFrame()
}

function onPointerUp() {
  if (!dragging.value) return
  dragging.value = false
  // Lâché sans mouvement récent : pas d'élan.
  if (last && performance.now() - last.t > 80) velocity = 0
  last = null
  scheduleFrame()
}

// Flèches gauche/droite quand la boîte a le focus clavier.
function onKeydown(event) {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    event.stopPropagation()
    target.ry += event.key === 'ArrowLeft' ? -30 : 30
    scheduleFrame()
  }
}

watch(
  () => [props.view, props.viewKey],
  () => goTo(props.view)
)

watch(
  () => [
    props.game.id,
    props.game.coverUrl,
    props.game.backCoverUrl,
    props.game.spineCoverUrl,
    props.game.title,
    props.platformLabel
  ],
  () => viewer && rebuild()
)

onMounted(() => {
  try {
    viewer = createViewerRenderer(canvas.value)
  } catch {
    failed.value = true
    return
  }
  goTo(props.view)
  pose = { ...target }
  resizeObserver = new ResizeObserver(([entry]) => {
    size = {
      width: Math.round(entry.contentRect.width * viewer.renderer.getPixelRatio()),
      height: Math.round(entry.contentRect.height * viewer.renderer.getPixelRatio())
    }
    scheduleFrame()
  })
  resizeObserver.observe(host.value)
  rebuild().then(scheduleFrame)
})

onBeforeUnmount(() => {
  buildToken++
  cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  model?.dispose()
  viewer?.dispose()
  viewer = null
})
</script>

<template>
  <div
    ref="host"
    class="viewer"
    :class="{ dragging }"
    tabindex="0"
    data-nav-skip
    role="img"
    :aria-label="`Boîte de ${game.title} en 3D`"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKeydown"
  >
    <canvas v-show="!failed" ref="canvas" class="canvas"></canvas>
    <img v-if="failed && game.coverUrl" class="fallback" :src="game.coverUrl" :alt="game.title" />
  </div>
</template>

<style scoped>
.viewer {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 520px;
  cursor: grab;
  touch-action: none;
  border-radius: 12px;
}
.viewer.dragging {
  cursor: grabbing;
}
.canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.fallback {
  position: absolute;
  inset: 10%;
  width: 80%;
  height: 80%;
  object-fit: contain;
}
</style>
