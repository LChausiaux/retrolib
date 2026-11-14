import { app } from 'electron'
import electronUpdater from 'electron-updater'

// Mise à jour automatique de RetroLib (electron-updater) depuis les Releases GitHub du
// dépôt public LChausiaux/retrolib (voir "publish" dans electron-builder.yml et le
// workflow .github/workflows/release.yml qui publie l'installeur et latest.yml).
//
// Fonctionnement : recherche au démarrage puis toutes les 6 heures, téléchargement en
// arrière-plan, installation à la fermeture de RetroLib — ou tout de suite via le
// bouton « Redémarrer » proposé dans la fenêtre. Rien ne se passe en développement
// (application non empaquetée : pas de latest.yml à comparer).

const { autoUpdater } = electronUpdater

const CHECK_INTERVAL_MS = 6 * 3600 * 1000
const FIRST_CHECK_DELAY_MS = 10 * 1000

// status : 'disabled' (version de développement) | 'idle' | 'checking' |
// 'up-to-date' | 'downloading' | 'downloaded' | 'error'.
let state = { status: app.isPackaged ? 'idle' : 'disabled' }
const listeners = new Set()

function setState(next) {
  state = { ...next, checkedAt: next.status === 'checking' ? state.checkedAt : Date.now() }
  for (const listener of listeners) listener(state)
}

export function getUpdateState() {
  return { ...state, currentVersion: app.getVersion() }
}

export function onUpdateStateChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Recherche manuelle (bouton des Réglages) ou périodique. Ne relance pas une
// recherche pendant un téléchargement ni quand la mise à jour attend le redémarrage.
export async function checkForUpdates() {
  if (!app.isPackaged) return getUpdateState()
  if (['checking', 'downloading', 'downloaded'].includes(state.status)) return getUpdateState()
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setState({ status: 'error', error: error?.message || String(error) })
  }
  return getUpdateState()
}

// Ferme RetroLib et lance l'installeur de la nouvelle version (installation
// silencieuse, puis RetroLib redémarre).
export function installUpdateNow() {
  if (state.status !== 'downloaded') return false
  // isSilent = true, isForceRunAfter = true.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
  return true
}

export function startAutoUpdates() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Journal dans la console du processus principal (utile en cas de souci).
  autoUpdater.logger = console

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => setState({ status: 'up-to-date' }))
  autoUpdater.on('update-available', (info) =>
    setState({ status: 'downloading', version: info.version, percent: 0 })
  )
  autoUpdater.on('download-progress', (progress) =>
    setState({ status: 'downloading', version: state.version, percent: progress.percent })
  )
  autoUpdater.on('update-downloaded', (info) =>
    setState({ status: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (error) =>
    setState({ status: 'error', error: error?.message || String(error) })
  )

  setTimeout(checkForUpdates, FIRST_CHECK_DELAY_MS)
  setInterval(checkForUpdates, CHECK_INTERVAL_MS).unref?.()
}
