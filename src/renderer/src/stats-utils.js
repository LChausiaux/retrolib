// Outils partagés par la fiche du jeu, la bibliothèque et la page Stats : formatage des
// durées/dates et agrégats calculés depuis la liste brute des sessions (voir
// main/stats.js, qui ne stocke que les sessions).

const DAY_MS = 24 * 60 * 60 * 1000

export function formatDuration(seconds) {
  const total = Math.round(seconds || 0)
  if (total < 60) return total > 0 ? '< 1 min' : '0 min'
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours >= 100 || rest === 0) return `${hours} h`
  return `${hours} h ${String(rest).padStart(2, '0')}`
}

// Version courte pour les cartes et les tuiles (« 12 h », « 45 min »).
export function formatDurationShort(seconds) {
  const minutes = Math.round((seconds || 0) / 60)
  if (minutes < 60) return `${Math.max(minutes, 1)} min`
  const hours = (seconds || 0) / 3600
  return hours < 10 ? `${hours.toFixed(1).replace('.', ',')} h` : `${Math.round(hours)} h`
}

export function startOfDay(ts) {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function dayKey(ts) {
  const date = new Date(ts)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function formatDate(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

export function formatRelative(ts, now = Date.now()) {
  if (!ts) return 'jamais'
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} jours`
  if (days < 14) return 'il y a 1 semaine'
  if (days < 31) return `il y a ${Math.floor(days / 7)} semaines`
  if (days < 365) {
    const months = Math.floor(days / 30)
    return `il y a ${months} mois`
  }
  return `le ${formatDate(ts)}`
}

// Agrégats par jeu : { [gameId]: { playtime, sessionCount, firstPlayed, lastPlayed,
// longestSession } }.
export function aggregateByGame(sessions) {
  const byGame = {}
  for (const session of sessions) {
    const entry = (byGame[session.gameId] ||= {
      playtime: 0,
      sessionCount: 0,
      firstPlayed: session.start,
      lastPlayed: session.end,
      longestSession: 0
    })
    entry.playtime += session.duration
    entry.sessionCount += 1
    entry.firstPlayed = Math.min(entry.firstPlayed, session.start)
    entry.lastPlayed = Math.max(entry.lastPlayed, session.end)
    entry.longestSession = Math.max(entry.longestSession, session.duration)
  }
  return byGame
}

// Temps de jeu par jour (clé dayKey -> secondes). Une session à cheval sur minuit est
// comptée sur son jour de départ : suffisant pour un calendrier d'activité.
export function playtimeByDay(sessions) {
  const byDay = {}
  for (const session of sessions) {
    const key = dayKey(session.start)
    byDay[key] = (byDay[key] || 0) + session.duration
  }
  return byDay
}

// Séries de jours consécutifs avec au moins une session : la série actuelle (qui
// compte encore si la dernière partie date d'hier) et le record.
export function computeStreaks(sessions, now = Date.now()) {
  const days = [...new Set(sessions.map((s) => startOfDay(s.start)))].sort((a, b) => a - b)
  let best = 0
  let run = 0
  let previous = null
  for (const day of days) {
    // Math.round : absorbe les journées de 23 h / 25 h des changements d'heure.
    run = previous !== null && Math.round((day - previous) / DAY_MS) === 1 ? run + 1 : 1
    best = Math.max(best, run)
    previous = day
  }
  const today = startOfDay(now)
  const lastDay = days[days.length - 1]
  const current = lastDay !== undefined && Math.round((today - lastDay) / DAY_MS) <= 1 ? run : 0
  return { current, best }
}

// Sessions terminées + sessions en cours comptées jusqu'à maintenant (marquées
// live), pour que les stats bougent pendant qu'on joue.
export function withLiveSessions(sessions, active, now) {
  return [
    ...sessions,
    ...active.map((session) => ({
      ...session,
      end: now,
      duration: Math.max(0, (now - session.start) / 1000),
      live: true
    }))
  ]
}

export function sumDuration(sessions) {
  return sessions.reduce((sum, session) => sum + session.duration, 0)
}

// Moments de la journée (selon l'heure de début de session), pondérés par le temps joué.
export const TIME_SLOTS = [
  { key: 'morning', label: 'Matin', phrase: 'le matin', icon: '🌅', from: 6, to: 12 },
  { key: 'afternoon', label: 'Après-midi', phrase: "l'après-midi", icon: '☀️', from: 12, to: 18 },
  { key: 'evening', label: 'Soirée', phrase: 'le soir', icon: '🌆', from: 18, to: 24 },
  { key: 'night', label: 'Nuit', phrase: 'la nuit', icon: '🌙', from: 0, to: 6 }
]

export function timeSlotBreakdown(sessions) {
  const totals = Object.fromEntries(TIME_SLOTS.map((slot) => [slot.key, 0]))
  for (const session of sessions) {
    const hour = new Date(session.start).getHours()
    const slot = TIME_SLOTS.find((s) => hour >= s.from && hour < s.to)
    totals[slot.key] += session.duration
  }
  const max = Math.max(...Object.values(totals), 1)
  return TIME_SLOTS.map((slot) => ({
    ...slot,
    playtime: totals[slot.key],
    share: (totals[slot.key] / max) * 100
  }))
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

export function favoriteWeekday(sessions) {
  const totals = new Array(7).fill(0)
  for (const session of sessions) {
    totals[new Date(session.start).getDay()] += session.duration
  }
  const max = Math.max(...totals)
  return max > 0 ? WEEKDAYS[totals.indexOf(max)] : null
}

export function longestSession(sessions) {
  let best = null
  for (const session of sessions) {
    if (!best || session.duration > best.duration) best = session
  }
  return best
}

export function biggestDay(sessions) {
  const byDay = new Map()
  for (const session of sessions) {
    const day = startOfDay(session.start)
    byDay.set(day, (byDay.get(day) || 0) + session.duration)
  }
  let best = null
  for (const [day, playtime] of byDay) {
    if (!best || playtime > best.playtime) best = { day, playtime }
  }
  return best
}

// Niveau d'intensité d'une case du calendrier d'activité (0 = pas joué).
function heatLevel(seconds) {
  if (!seconds) return 0
  const minutes = seconds / 60
  if (minutes < 30) return 1
  if (minutes < 60) return 2
  if (minutes < 120) return 3
  return 4
}

// Calendrier d'activité : les `weekCount` dernières semaines, une colonne par semaine
// (lundi en haut), avec une étiquette de mois sur la semaine qui contient le 1er.
export function buildHeatmap(sessions, now, weekCount) {
  const byDay = playtimeByDay(sessions)
  const today = new Date(startOfDay(now))
  const mondayOffset = (today.getDay() + 6) % 7
  const start = new Date(today)
  start.setDate(start.getDate() - mondayOffset - (weekCount - 1) * 7)
  const weeks = []
  for (let w = 0; w < weekCount; w++) {
    const days = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      const ts = date.getTime()
      const future = ts > today.getTime()
      const seconds = future ? 0 : byDay[dayKey(ts)] || 0
      days.push({ ts, seconds, level: heatLevel(seconds), future })
    }
    const firstOfMonth = days.find((day) => new Date(day.ts).getDate() === 1)
    const labelDay = firstOfMonth || (w === 0 ? days[0] : null)
    const month = labelDay
      ? new Date(labelDay.ts).toLocaleDateString('fr-FR', { month: 'short' })
      : ''
    weeks.push({ key: days[0].ts, days, month })
  }
  return weeks
}
