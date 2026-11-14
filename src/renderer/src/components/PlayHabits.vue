<script setup>
import { computed } from 'vue'
import { timeSlotBreakdown, favoriteWeekday, formatDuration } from '../stats-utils'

// "Habitudes" : moment de la journée préféré (4 barres) et jour de la semaine préféré,
// pondérés par le temps joué — page Stats et fiche du jeu.
const props = defineProps({
  sessions: { type: Array, required: true },
  // Début de la phrase : "Tu joues" (page Stats) ou "Tu y joues" (fiche du jeu).
  subject: { type: String, default: 'Tu joues' }
})

const slots = computed(() => timeSlotBreakdown(props.sessions))

const favoriteSlot = computed(() => {
  const best = [...slots.value].sort((a, b) => b.playtime - a.playtime)[0]
  return best?.playtime ? best : null
})

const weekday = computed(() => favoriteWeekday(props.sessions))
</script>

<template>
  <div class="habits">
    <p v-if="favoriteSlot" class="fun-fact">
      {{ subject }} surtout <strong>{{ favoriteSlot.phrase }}</strong> {{ favoriteSlot.icon }}
      <template v-if="weekday"
        >· jour préféré : <strong>{{ weekday }}</strong></template
      >
    </p>
    <div class="slots">
      <div
        v-for="slot in slots"
        :key="slot.key"
        class="slot"
        :title="formatDuration(slot.playtime)"
      >
        <div class="slot-track">
          <div class="slot-fill" :style="{ height: slot.share + '%' }"></div>
        </div>
        <span class="slot-icon">{{ slot.icon }}</span>
        <span class="slot-label">{{ slot.label }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.habits {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fun-fact {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
}
.slots {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.slot-track {
  width: 100%;
  height: 64px;
  display: flex;
  align-items: flex-end;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
}
.slot-fill {
  width: 100%;
  border-radius: 4px 4px 0 0;
  background: #7d8cff;
}
.slot-icon {
  font-size: 1rem;
}
.slot-label {
  font-size: 0.68rem;
  opacity: 0.6;
}
</style>
