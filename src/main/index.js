import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  Tray,
  Menu,
  nativeImage
} from 'electron'
import { join, isAbsolute, extname } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  getRomStationPath,
  setRomStationPath,
  setOverride,
  setEmulatorPreference,
  setEmulatorPathOverride,
  setEmulatorLaunchOptions,
  setFavorite,
  setPathIgnored,
  setGameMetadataOverride,
  getCoverSourceSettings,
  setCoverSourceSettings
} from './config'
import {
  startAppUsageTracking,
  setAppUsageActive,
  trackGameSession,
  flushAllTracking,
  getActiveSessions,
  getStatsPayload
} from './stats'
import { buildLibrary, resolveEmulatorVersions } from './library'
import { launchGame, openEmulator, isGameBusy } from './launcher'
import { clearExtraction, analyzeExtraction } from './extraction'
import { checkEmulatorUpdate } from './emulator-updates'
import { setGameCoverImage } from './game-cover'
import {
  searchCoverCandidates,
  downloadCoverCandidate,
  getCoverSourcesStatus
} from './cover-sources'
import {
  importMissingBoxArt,
  cancelBulkImport,
  getGameDetails,
  getLibraryMetadata,
  searchLaunchboxGames,
  downloadLaunchboxIndex,
  getLaunchboxStatus,
  onLaunchboxStateChange
} from './launchbox-db'
import {
  getAutoBackCovers,
  setAutoBackCovers,
  getRecentBackAttempts,
  recordBackAttempts,
  getLaunchboxMatchOverrides,
  setLaunchboxMatchOverride
} from './config'
import { createLibraryWatcher } from './library-watcher'
import {
  startAutoUpdates,
  checkForUpdates,
  installUpdateNow,
  getUpdateState,
  onUpdateStateChange
} from './updater'
import { PLATFORM_LABELS, ASSIGNABLE_PLATFORMS } from './platforms'

// En mode dev, la page est chargée depuis http://localhost (serveur Vite) et non
// depuis file:// : Electron bloque alors par sécurité tout chargement de ressource
// file:// depuis une page web ("Not allowed to load local resource"), même si la CSP
// l'autorise. On sert donc les jaquettes via un schéma personnalisé géré par le
// processus principal, qui n'est pas soumis à cette restriction — voir aussi
// library.js (construction de coverUrl) et le protocol.handle plus bas.
// Extensions servies par le schéma "retrolib-cover" (voir protocol.handle plus bas).
const COVER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'retrolib-cover',
    // Pas de "standard: true" : on ne veut PAS que Chromium parse le chemin comme
    // une autorité (host). Sur Windows, "retrolib-cover://E:/..." serait alors
    // interprété comme host "e" (minuscule, sans le ":"), ce qui casse tout.
    // Le chemin est donc transmis en une seule fois, encodé, comme partie opaque
    // de l'URL (pas de "//"), voir library.js et le protocol.handle plus bas.
    privileges: { secure: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true }
  }
])

// Comme Discord : fermer la fenêtre (croix) ne quitte pas RetroLib, elle se réduit
// dans la zone de notification (icônes cachées de la barre des tâches) et reste
// disponible. On ne quitte vraiment que via "Quitter" du menu de l'icône (ou une
// fermeture de session Windows), ce qui passe isQuitting à true.
let mainWindow = null
let tray = null
let isQuitting = false

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// Durée lisible pour l'infobulle et le menu de l'icône (« 12 min », « 1 h 05 »).
function formatElapsed(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

// Infobulle et menu de l'icône de notification : affichent le(s) jeu(x) en cours et
// le temps de la session. Rafraîchis au début/à la fin d'une session (voir
// notifyStatsChanged) et toutes les 30 s tant qu'un jeu tourne (voir trayTimer).
let trayTimer = null

function updateTray() {
  if (!tray || tray.isDestroyed()) return
  const sessions = getActiveSessions()
  const now = Date.now()
  const playingLines = sessions.map(
    (session) => `${session.title} — ${formatElapsed(now - session.start)}`
  )

  // Infobulle Windows limitée à 127 caractères.
  const tooltip = playingLines.length
    ? `RetroLib — En jeu : ${playingLines.join(' · ')}`
    : 'RetroLib'
  tray.setToolTip(tooltip.length > 127 ? tooltip.slice(0, 126) + '…' : tooltip)

  const playingItems = playingLines.length
    ? [
        { label: 'En jeu', enabled: false },
        ...playingLines.map((line) => ({ label: `● ${line}`, enabled: false })),
        { type: 'separator' }
      ]
    : []
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...playingItems,
      { label: 'Ouvrir RetroLib', click: showMainWindow },
      { type: 'separator' },
      {
        label: 'Quitter',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )

  if (sessions.length && !trayTimer) {
    trayTimer = setInterval(updateTray, 30 * 1000)
  } else if (!sessions.length && trayTimer) {
    clearInterval(trayTimer)
    trayTimer = null
  }
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  updateTray()
  // Clic simple sur l'icône : rouvre la fenêtre (le clic droit affiche le menu).
  tray.on('click', showMainWindow)
}

// Envoie un événement à toutes les fenêtres ouvertes.
function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

// Une session de jeu commence ou se termine : le renderer rafraîchit ses stats (badge
// "En jeu", temps de jeu de la fiche, page Stats) et l'icône de notification aussi.
function notifyStatsChanged() {
  broadcast('stats:changed')
  updateTray()
}

// Jeux ajoutés / supprimés dans le dossier RomStation : la fenêtre recharge la
// bibliothèque d'elle-même (voir library-watcher.js).
const libraryWatcher = createLibraryWatcher({
  onChange: () => broadcast('library:changed')
})

// État de la base LaunchBox (téléchargement, prête) relayé à la fenêtre, au plus
// quatre fois par seconde pendant un téléchargement (une progression par morceau reçu
// saturerait l'IPC pour rien) ; les changements de phase passent toujours.
function relayLaunchboxState() {
  let last = null
  let lastSent = 0
  let pending = null
  return (state) => {
    const phaseChanged = !last || last.building !== state.building || last.phase !== state.phase
    last = state
    clearTimeout(pending)
    const wait = phaseChanged ? 0 : Math.max(0, 250 - (Date.now() - lastSent))
    pending = setTimeout(() => {
      lastSent = Date.now()
      broadcast('launchbox:state', last)
    }, wait)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Bac à sable activé : le preload n'utilise que contextBridge et ipcRenderer
      // (aucun module Node), la page n'a donc accès qu'à l'API exposée (window.api).
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    // RetroLib est surtout utilisée en grand (bibliothèque de plusieurs centaines de
    // jeux) : on démarre donc maximisée plutôt qu'en petite fenêtre 1100x720.
    mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.on('hide', () => setAppUsageActive(false))
  mainWindow.on('show', () => setAppUsageActive(true))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers() {
  ipcMain.handle('library:get', () => {
    const installRoot = getRomStationPath()
    const platformCatalog = {
      labels: PLATFORM_LABELS,
      assignable: ASSIGNABLE_PLATFORMS
    }
    if (!installRoot) return { configured: false, games: [], platformCatalog }
    try {
      const { games, platformsWithChoice, emulatorStatus, gamesPath, fingerprint, ignoredPaths } =
        buildLibrary(installRoot)
      libraryWatcher.update(gamesPath, fingerprint)
      return {
        configured: true,
        installRoot,
        games,
        gamesPath,
        ignoredPaths,
        platformsWithChoice,
        emulatorStatus,
        platformCatalog
      }
    } catch (error) {
      return { configured: true, installRoot, games: [], platformCatalog, error: error.message }
    }
  })

  // Versions installées des émulateurs (lecture dans les exe, potentiellement lente) :
  // demandée par le renderer APRÈS l'affichage de la bibliothèque, voir
  // library.js: resolveEmulatorVersions. Renvoie { <chemin exe>: version | null }.
  ipcMain.handle('emulator:getVersions', (_event, exePaths) => {
    return resolveEmulatorVersions(exePaths)
  })

  ipcMain.handle('library:chooseRomStationFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: "Sélectionne le dossier d'installation de RomStation",
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    setRomStationPath(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle('library:launch', async (event, game, discIndex) => {
    // Peut prendre du temps la première fois (extraction du/des zip(s) du jeu, voir
    // launcher.js) : le renderer attend la fin via await avant de réactiver le bouton,
    // et reçoit entre-temps la progression de la décompression via cet événement pour
    // afficher une barre de progression.
    const child = await launchGame(game, discIndex, (progress) => {
      event.sender.send('launch:progress', { gameId: game.id, ...progress })
    })
    // null : le jeu tournait déjà, sa fenêtre a simplement été ramenée au premier plan
    // (voir launcher.js) — la session en cours continue, rien à suivre de plus.
    if (!child) return { alreadyRunning: true }
    // Suivi du temps de jeu : la session court jusqu'à la fermeture de l'émulateur.
    trackGameSession(game, child, notifyStatsChanged)
    notifyStatsChanged()
    return { alreadyRunning: false }
  })

  // Stats : sessions de jeu, sessions en cours et utilisation de l'application — les
  // agrégats sont calculés côté renderer.
  ipcMain.handle('stats:get', () => getStatsPayload())

  // Réglages : version de RetroLib (celle de package.json, reprise dans l'installeur).
  ipcMain.handle('app:getVersion', () => app.getVersion())

  // Page du jeu : "Supprimer le contenu décompressé" — remet le jeu à l'état zip pour
  // qu'une extraction ratée/incomplète soit refaite au prochain lancement.
  ipcMain.handle('library:clearExtraction', (_event, game) => {
    if (isGameBusy(game.id)) {
      throw new Error(`"${game.title || 'Ce jeu'}" est en cours d'exécution : ferme-le avant.`)
    }
    return clearExtraction(game)
  })

  // Page Stockage : taille du contenu décompressé de chaque jeu (fichiers ré-extractibles
  // depuis le zip d'origine uniquement, voir extraction.js: analyzeExtraction).
  ipcMain.handle('storage:analyze', (_event, games) => {
    return games.map((game) => {
      const { files, extractedBytes, zipBytes, unsafeDirs } = analyzeExtraction(game)
      return {
        id: game.id,
        extractedBytes,
        zipBytes,
        fileCount: files.length,
        unsafe: unsafeDirs > 0,
        busy: isGameBusy(game.id)
      }
    })
  })

  // Page Stockage : nettoyage groupé. Les jeux en cours d'exécution sont ignorés.
  ipcMain.handle('storage:clean', (_event, games) => {
    let freedBytes = 0
    let cleaned = 0
    const skipped = []
    for (const game of games) {
      if (isGameBusy(game.id)) {
        skipped.push(game.title)
        continue
      }
      const result = clearExtraction(game)
      if (result.removed > 0) cleaned++
      freedBytes += result.freedBytes
    }
    return { cleaned, freedBytes, skipped }
  })

  ipcMain.handle('library:setOverride', (_event, { gameId, platform }) => {
    setOverride(gameId, platform)
    return true
  })

  // Réglages > Bibliothèque : ignorer (ou rétablir) un dossier ou fichier du dossier des
  // jeux, voir config.js: getIgnoredPaths.
  ipcMain.handle('library:setIgnored', (_event, { path, ignored }) => {
    if (typeof path !== 'string' || !path) return false
    setPathIgnored(path, Boolean(ignored))
    return true
  })

  ipcMain.handle('library:setFavorite', (_event, { gameId, favorite }) => {
    setFavorite(gameId, favorite)
    return true
  })

  // Page du jeu : édition manuelle du titre/année/développeur/éditeur (corrige une
  // fiche fausse ou incomplète, voir config.js).
  ipcMain.handle(
    'library:setGameMetadata',
    (_event, { gameId, title, year, developer, publisher }) => {
      setGameMetadataOverride(gameId, { title, year, developer, publisher })
      return true
    }
  )

  // Page du jeu : "Changer la jaquette" — choix d'un fichier image, puis déplacement
  // dans le dossier "images" du jeu (voir game-cover.js).
  ipcMain.handle('library:chooseCoverImage', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choisir une image de jaquette',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('library:setGameCover', (_event, { folderPath, romPath, sourcePath, face }) => {
    return setGameCoverImage({ folderPath, romPath }, sourcePath, face)
  })

  // Fenêtre "Choisir une jaquette" : recherche en ligne (voir cover-sources.js), puis
  // téléchargement de l'image retenue et rangement comme une jaquette choisie à la main.
  ipcMain.handle('covers:search', (_event, { platform, query, face }) => {
    return searchCoverCandidates({ platform, query, face })
  })

  ipcMain.handle('covers:apply', async (_event, { folderPath, romPath, url, face }) => {
    const tempPath = await downloadCoverCandidate(url)
    return setGameCoverImage({ folderPath, romPath }, tempPath, face)
  })

  // Réglages : récupère les dos et tranches manquants depuis la base LaunchBox, puis
  // ScreenScraper en secours s'il est configuré (voir launchbox-db.js), avec une
  // progression envoyée à la fenêtre.
  ipcMain.handle('covers:importBoxArt', (event, games) => {
    return importMissingBoxArt(
      games,
      (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('covers:importProgress', progress)
      },
      { fallback: true }
    )
  })

  // Démarrage / nouveau scan : ajoute le dos français (sinon européen) des jeux qui
  // n'en ont pas, sans réinterroger ceux déjà tentés récemment (voir config.js).
  ipcMain.handle('covers:autoBacks', async (_event, games) => {
    if (!getAutoBackCovers()) return { skipped: true }
    const recent = getRecentBackAttempts()
    const todo = games.filter((game) => !game.hasBack && !recent.has(game.id))
    if (!todo.length) return { skipped: true }
    const report = await importMissingBoxArt(todo, null, { backsOnly: true })
    recordBackAttempts(report.attempted)
    return report
  })

  ipcMain.handle('covers:getAutoBacks', () => getAutoBackCovers())

  ipcMain.handle('covers:setAutoBacks', (_event, enabled) => {
    setAutoBackCovers(enabled)
    return getAutoBackCovers()
  })

  ipcMain.handle('covers:cancelImport', () => {
    cancelBulkImport()
    return true
  })

  ipcMain.handle('covers:getSources', () => ({
    settings: getCoverSourceSettings(),
    status: getCoverSourcesStatus()
  }))

  ipcMain.handle('covers:setSources', (_event, values) => {
    setCoverSourceSettings(values)
    return getCoverSourcesStatus()
  })

  // Fiches de jeu (base LaunchBox, voir launchbox-db.js) : fiche complète d'un jeu,
  // genres de toute la bibliothèque (filtre), correction manuelle du rapprochement.
  ipcMain.handle('details:get', (_event, game) => {
    return getGameDetails(game, getLaunchboxMatchOverrides()[game.id])
  })

  ipcMain.handle('details:library', (_event, games) => {
    return getLibraryMetadata(games, getLaunchboxMatchOverrides())
  })

  ipcMain.handle('details:search', (_event, { platform, query }) => {
    return searchLaunchboxGames(platform, query)
  })

  ipcMain.handle('details:setMatch', (_event, { gameId, launchboxId }) => {
    setLaunchboxMatchOverride(gameId, launchboxId)
    return true
  })

  ipcMain.handle('details:status', () => getLaunchboxStatus())

  ipcMain.handle('details:download', () => downloadLaunchboxIndex())

  // Mise à jour automatique de RetroLib (voir updater.js).
  ipcMain.handle('update:getState', () => getUpdateState())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdateNow())

  ipcMain.handle('library:setEmulatorPreference', (_event, { platform, emulatorName }) => {
    setEmulatorPreference(platform, emulatorName)
    return true
  })

  ipcMain.handle('library:setEmulatorPathOverride', (_event, { platform, path }) => {
    setEmulatorPathOverride(platform, path)
    return true
  })

  // Page de config dédiée par émulateur (arguments de lancement personnalisés) :
  // voir config.js / launcher.js.
  ipcMain.handle(
    'library:setEmulatorLaunchOptions',
    (_event, { platform, launchArgs, standaloneArgs }) => {
      setEmulatorLaunchOptions(platform, { launchArgs, standaloneArgs })
      return true
    }
  )

  // Page Émulateurs : "Parcourir…" pour un chemin personnalisé (émulateur non
  // détecté automatiquement, ou installé ailleurs que dans le dossier RomStation).
  ipcMain.handle('emulator:open', async (_event, { emulatorPath, standaloneArgs }) => {
    await openEmulator(emulatorPath, standaloneArgs)
    return true
  })

  // Bouton "Ouvrir le dossier" de la page Émulateurs : révèle l'exécutable dans
  // l'explorateur de fichiers (utile pour vérifier/nettoyer manuellement l'install).
  ipcMain.handle('emulator:openFolder', (_event, emulatorPath) => {
    shell.showItemInFolder(emulatorPath)
    return true
  })

  ipcMain.handle('emulator:chooseExecutable', async () => {
    const result = await dialog.showOpenDialog({
      title: "Sélectionne l'exécutable de l'émulateur",
      properties: ['openFile'],
      filters:
        process.platform === 'win32' ? [{ name: 'Exécutables', extensions: ['exe'] }] : undefined
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  // Vérification à la demande (bouton, jamais automatique) : la source (GitHub, tags,
  // endpoint JSON custom...) est déterminée par le nom de l'émulateur, voir la table
  // en dur dans emulator-updates.js — jamais d'appel réseau au simple scan/chargement.
  ipcMain.handle('emulator:checkUpdate', async (_event, { name }) => {
    return checkEmulatorUpdate(name)
  })
}

// Une seule instance : relancer RetroLib (raccourci, menu Démarrer) alors qu'elle
// tourne déjà dans la zone de notification réaffiche simplement la fenêtre existante.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (app.isReady()) showMainWindow()
  })
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return

  electronApp.setAppUserModelId('com.retrolib')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // "retrolib-cover://<chemin encodé>" -> relit le même chemin en file:// mais
  // depuis le processus principal (net.fetch), donc sans la restriction de sécurité
  // qui bloque file:// depuis une page servie en http (mode dev).
  protocol.handle('retrolib-cover', async (request) => {
    // request.url = "retrolib-cover:<chemin encodé une seule fois avec encodeURIComponent>"
    // Suffixe "?v=..." (anti-cache, voir library.js) ignoré.
    const encodedPath = request.url.slice('retrolib-cover:'.length).split('?')[0]
    let filePath
    try {
      filePath = decodeURIComponent(encodedPath)
    } catch {
      return new Response(null, { status: 400 })
    }
    // Ce schéma ne sert que des jaquettes : on refuse tout ce qui n'est pas une image
    // locale désignée par un chemin absolu, pour qu'il ne puisse pas servir à lire
    // n'importe quel fichier du disque depuis la page.
    if (!isAbsolute(filePath) || !COVER_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      return new Response(null, { status: 403 })
    }
    try {
      // En-tête CORS : la boîte 3D (renderer, box3d.js) charge les jaquettes avec
      // fetch() pour en faire des textures WebGL, ce qu'une image d'une autre origine
      // sans CORS interdirait (page servie depuis http://localhost en dev).
      const response = await net.fetch(pathToFileURL(filePath).href)
      const headers = new Headers(response.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(response.body, { status: response.status, headers })
    } catch {
      // Jaquette supprimée ou déplacée entre le scan et l'affichage.
      return new Response(null, { status: 404 })
    }
  })

  registerIpcHandlers()
  onLaunchboxStateChange(relayLaunchboxState())
  onUpdateStateChange(() => broadcast('update:state', getUpdateState()))
  startAutoUpdates()
  startAppUsageTracking()
  createWindow()
  createTray()

  app.on('activate', showMainWindow)
})

// Clôture les sessions de jeu encore ouvertes et enregistre le temps passé dans
// RetroLib (voir stats.js).
app.on('before-quit', () => {
  // Quitter depuis ailleurs que le menu de l'icône (Alt+F4 sur macOS, arrêt de
  // Windows...) : on laisse alors la fenêtre se fermer réellement.
  isQuitting = true
  libraryWatcher.stop()
  flushAllTracking()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
