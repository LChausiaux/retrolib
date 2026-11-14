import { app } from 'electron'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from './json-store'

// Suivi d'utilisation (temps de jeu, sessions, ouvertures de RetroLib) : fichier à part
// des réglages (retrolib-settings.json) parce qu'il grossit avec le temps (une entrée
// par session de jeu) et n'a rien d'un réglage. Les agrégats (temps total par jeu,
// dernière partie...) ne sont PAS stockés : ils sont recalculés depuis la liste des
// sessions (voir buildStatsPayload), une seule source de vérité.
const STATS_FILE = join(app.getPath('userData'), 'retrolib-stats.json')

// En dessous, la "session" n'en est pas une : émulateur qui plante au démarrage,
// mauvais disque, fermé aussitôt ouvert... On ne la compte pas, pour ne pas fausser le
// nombre de sessions ni gonfler les stats pour rien.
const MIN_SESSION_SECONDS = 20

// Fréquence d'enregistrement du temps passé dans RetroLib : écrit au fil de l'eau
// plutôt qu'à la seule fermeture, pour ne pas tout perdre en cas de plantage ou
// d'extinction brutale du PC.
const APP_HEARTBEAT_MS = 60 * 1000

// Écriture atomique avec sauvegarde (voir json-store.js) : avant, un fichier tronqué
// par une coupure de courant était relu comme vide, et la sauvegarde suivante (au plus
// une minute après) effaçait définitivement tout l'historique de jeu.
function readStats() {
  const data = readJsonFile(STATS_FILE, null) || {}
  return {
    app: data.app || {},
    sessions: Array.isArray(data.sessions) ? data.sessions : []
  }
}

function writeStats(stats) {
  writeJsonFile(STATS_FILE, stats)
}

// Sessions de jeu en cours (émulateur encore ouvert), par id de jeu.
const activeSessions = new Map()

let appLastTick = null

// À appeler au démarrage de RetroLib : compte l'ouverture et démarre le suivi du temps
// passé dans l'application.
export function startAppUsageTracking() {
  const stats = readStats()
  const now = Date.now()
  stats.app.firstOpen = stats.app.firstOpen || now
  stats.app.openCount = (stats.app.openCount || 0) + 1
  stats.app.totalOpenSeconds = stats.app.totalOpenSeconds || 0
  writeStats(stats)
  appLastTick = now
  setInterval(flushAppUsage, APP_HEARTBEAT_MS).unref?.()
}

// RetroLib réduite dans la zone de notification (fenêtre masquée, voir index.js) :
// ce temps-là n'est pas du temps "passé dans l'application", on suspend donc le
// compteur tant que la fenêtre est cachée et on le relance à sa réapparition.
export function setAppUsageActive(active) {
  if (active) {
    if (appLastTick === null) appLastTick = Date.now()
  } else {
    flushAppUsage()
    appLastTick = null
  }
}

function flushAppUsage() {
  if (appLastTick === null) return
  const now = Date.now()
  const stats = readStats()
  stats.app.totalOpenSeconds = (stats.app.totalOpenSeconds || 0) + (now - appLastTick) / 1000
  appLastTick = now
  writeStats(stats)
}

function recordSession(session, end) {
  const duration = Math.round((end - session.start) / 1000)
  if (duration < MIN_SESSION_SECONDS) return null
  const stats = readStats()
  const entry = { ...session, end, duration }
  stats.sessions.push(entry)
  writeStats(stats)
  return entry
}

// Commence le suivi d'une session dès que l'émulateur est lancé ; elle se termine à la
// fermeture du processus. Limite connue : un émulateur qui relance un autre processus
// et se ferme aussitôt (lanceur intermédiaire) donnera une session trop courte, donc
// ignorée.
// onEnd(entry|null) est appelé à la fin de la session (null si elle était trop courte).
export function trackGameSession(game, child, onEnd) {
  const session = {
    gameId: game.id,
    // Titre/plateforme figés au moment de la session : les stats restent lisibles
    // même si le jeu est ensuite supprimé de RomStation ou renommé.
    title: game.title,
    platform: game.platform || null,
    start: Date.now()
  }
  activeSessions.set(game.id, session)
  let ended = false
  const finish = () => {
    if (ended) return
    ended = true
    if (activeSessions.get(game.id) === session) activeSessions.delete(game.id)
    onEnd?.(recordSession(session, Date.now()))
  }
  child.once('exit', finish)
  child.once('error', finish)
}

// À la fermeture de RetroLib : on ne peut plus surveiller les émulateurs encore
// ouverts, on clôture donc leur session maintenant (le temps joué jusqu'ici est
// conservé), et on enregistre le temps passé dans l'application.
export function flushAllTracking() {
  const now = Date.now()
  for (const session of activeSessions.values()) recordSession(session, now)
  activeSessions.clear()
  flushAppUsage()
}

// Sessions en cours (titre, début) : infobulle et menu de l'icône de notification.
export function getActiveSessions() {
  return [...activeSessions.values()].map(({ gameId, title, start }) => ({ gameId, title, start }))
}

export function getActiveGameIds() {
  return [...activeSessions.keys()]
}

// Données brutes pour le renderer : il calcule lui-même les agrégats affichés (fiche du
// jeu, page Stats) — c'est peu de données et ça évite un aller-retour IPC par vue.
export function getStatsPayload() {
  const stats = readStats()
  return {
    app: {
      firstOpen: stats.app.firstOpen || null,
      openCount: stats.app.openCount || 0,
      totalOpenSeconds:
        (stats.app.totalOpenSeconds || 0) +
        (appLastTick !== null ? (Date.now() - appLastTick) / 1000 : 0)
    },
    sessions: stats.sessions,
    active: [...activeSessions.values()]
  }
}
