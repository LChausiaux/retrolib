<script setup>
import { computed } from 'vue'
import { buildHeatmap, formatDuration } from '../stats-utils'

// Calendrier d'activité (une case par jour, de plus en plus soutenue avec le temps
// joué) : page Stats (6 mois) et fiche du jeu (version réduite).
const props = defineProps({
  sessions: { type: Array, required: true },
  now: { type: Number, required: true },
  weeks: { type: Number, default: 26 }
})

const heatmap = computed(() => buildHeatmap(props.sessions, props.now, props.weeks))

const activeDays = computed(
  () => heatmap.value.flatMap((week) => week.days).filter((day) => day.seconds).length
)

function heatTooltip(day) {
  const label = new Date(day.ts).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
  return `${label} : ${day.seconds ? formatDuration(day.seconds) : 'pas joué'}`
}
</script>

<template>
  <div class="activity-heatmap">
    <div class="heatmap">
      <div class="heatmap-days">
        <span>lun</span>
        <span></span>
        <span>mer</span>
        <span></span>
        <span>ven</span>
        <span></span>
        <span>dim</span>
      </div>
      <div class="heatmap-weeks">
        <div v-for="week in heatmap" :key="week.key" class="heatmap-week">
          <span class="heatmap-month">{{ week.month }}</span>
          <div
            v-for="day in week.days"
            :key="day.ts"
            class="heat-cell"
            :class="[`level-${day.level}`, { future: day.future }]"
            :title="day.future ? '' : heatTooltip(day)"
          ></div>
        </div>
      </div>
    </div>
    <div class="heat-legend">
      <span
        >{{ activeDays }} jour{{ activeDays > 1 ? 's' : '' }} joué{{
          activeDays > 1 ? 's' : ''
        }}</span
      >
      <span class="heat-legend-scale">
        <span>Moins</span>
        <div v-for="level in 5" :key="level" class="heat-cell" :class="`level-${level - 1}`"></div>
        <span>Plus</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Une seule teinte, de plus en plus soutenue avec le temps joué (échelle
   séquentielle : < 30 min, < 1 h, < 2 h, 2 h et +), cases vides en gris discret. */
.activity-heatmap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.heatmap {
  display: flex;
  gap: 6px;
  overflow-x: auto;
}
.heatmap-days {
  display: grid;
  grid-template-rows: 14px repeat(7, 13px);
  row-gap: 3px;
  font-size: 0.6rem;
  opacity: 0.45;
}
.heatmap-days span:first-child {
  grid-row: 2;
}
.heatmap-weeks {
  display: flex;
  gap: 3px;
}
.heatmap-week {
  display: grid;
  grid-template-rows: 14px repeat(7, 13px);
  row-gap: 3px;
}
.heatmap-month {
  font-size: 0.6rem;
  opacity: 0.5;
  white-space: nowrap;
  width: 13px;
  overflow: visible;
}
.heat-cell {
  width: 13px;
  height: 13px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
}
.heat-cell.level-1 {
  background: rgba(125, 140, 255, 0.3);
}
.heat-cell.level-2 {
  background: rgba(125, 140, 255, 0.52);
}
.heat-cell.level-3 {
  background: rgba(125, 140, 255, 0.76);
}
.heat-cell.level-4 {
  background: #9aa6ff;
}
.heat-cell.future {
  background: transparent;
}
.heatmap-week .heat-cell:not(.future):hover {
  outline: 1px solid rgba(255, 255, 255, 0.6);
}
.heat-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 0.65rem;
  opacity: 0.6;
}
.heat-legend-scale {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
