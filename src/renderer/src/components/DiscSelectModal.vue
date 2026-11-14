<script setup>
defineProps({
  game: { type: Object, required: true }
})
const emit = defineEmits(['choose', 'cancel'])

function baseName(path) {
  return String(path).split(/[\\/]/).pop()
}
</script>

<template>
  <div class="modal-backdrop" data-nav-scope @click.self="emit('cancel')">
    <div class="modal-panel">
      <h2>Choisir un disque</h2>
      <p class="modal-subtitle">{{ game.title }}</p>
      <p class="modal-hint">
        Ce jeu contient plusieurs disques. Choisis celui sur lequel démarrer — les autres restent
        accessibles ensuite via le changeur de disque de l'émulateur.
      </p>

      <div class="disc-list">
        <button
          v-for="(path, index) in game.discPaths"
          :key="path"
          class="disc-item"
          :data-nav-default="index === 0 ? '' : null"
          @click="emit('choose', index)"
        >
          <span class="disc-label">Disque {{ index + 1 }}</span>
          <span class="disc-filename">{{ baseName(path) }}</span>
        </button>
      </div>

      <button class="modal-cancel" data-nav-cancel @click="emit('cancel')">Annuler</button>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal-panel {
  width: min(420px, 90vw);
  background: #1e1e25;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 22px 24px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.modal-panel h2 {
  margin: 0 0 4px;
  font-size: 1.1rem;
}
.modal-subtitle {
  margin: 0 0 10px;
  font-size: 0.9rem;
  opacity: 0.75;
}
.modal-hint {
  margin: 0 0 16px;
  font-size: 0.8rem;
  opacity: 0.6;
  line-height: 1.4;
}
.disc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.disc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #24242b;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.disc-item:hover {
  background: rgba(120, 140, 255, 0.18);
  border-color: rgba(120, 140, 255, 0.3);
}
.disc-label {
  font-weight: 600;
  font-size: 0.9rem;
}
.disc-filename {
  font-size: 0.75rem;
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
}
.modal-cancel {
  width: 100%;
  padding: 8px 16px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: inherit;
  cursor: pointer;
}
.modal-cancel:hover {
  background: rgba(255, 255, 255, 0.06);
}
</style>
