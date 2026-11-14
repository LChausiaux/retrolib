import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  getEmulatorVersions: (exePaths) => ipcRenderer.invoke('emulator:getVersions', exePaths),
  chooseRomStationFolder: () => ipcRenderer.invoke('library:chooseRomStationFolder'),
  launchGame: (game, discIndex) => ipcRenderer.invoke('library:launch', game, discIndex),
  clearExtraction: (game) => ipcRenderer.invoke('library:clearExtraction', game),
  // Page Stockage : taille du contenu décompressé par jeu, puis nettoyage groupé.
  analyzeStorage: (games) => ipcRenderer.invoke('storage:analyze', games),
  cleanStorage: (games) => ipcRenderer.invoke('storage:clean', games),
  setPlatformOverride: (gameId, platform) =>
    ipcRenderer.invoke('library:setOverride', { gameId, platform }),
  setFavorite: (gameId, favorite) =>
    ipcRenderer.invoke('library:setFavorite', { gameId, favorite }),
  setGameMetadata: (gameId, metadata) =>
    ipcRenderer.invoke('library:setGameMetadata', { gameId, ...metadata }),
  getStats: () => ipcRenderer.invoke('stats:get'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  // Prévient quand une session de jeu commence ou se termine : renvoie une fonction de
  // désabonnement (même principe que onLaunchProgress).
  onStatsChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('stats:changed', listener)
    return () => ipcRenderer.removeListener('stats:changed', listener)
  },
  chooseCoverImage: () => ipcRenderer.invoke('library:chooseCoverImage'),
  setGameCover: (folderPath, romPath, sourcePath, face = 'front') =>
    ipcRenderer.invoke('library:setGameCover', { folderPath, romPath, sourcePath, face }),
  // Jaquettes en ligne (voir main/cover-sources.js).
  // face = 'front' (jaquette) ou 'back' (dos de la boîte, ScreenScraper uniquement).
  searchCovers: (platform, query, face = 'front') =>
    ipcRenderer.invoke('covers:search', { platform, query, face }),
  applyRemoteCover: (folderPath, romPath, url, face = 'front') =>
    ipcRenderer.invoke('covers:apply', { folderPath, romPath, url, face }),
  getCoverSources: () => ipcRenderer.invoke('covers:getSources'),
  // Import groupé des dos et tranches depuis LaunchBox (voir main/launchbox-db.js).
  importBoxArt: (games) => ipcRenderer.invoke('covers:importBoxArt', games),
  cancelBoxArtImport: () => ipcRenderer.invoke('covers:cancelImport'),
  // Ajout automatique du dos (France, sinon Europe) au démarrage, et son réglage.
  autoAddBackCovers: (games) => ipcRenderer.invoke('covers:autoBacks', games),
  getAutoBackCovers: () => ipcRenderer.invoke('covers:getAutoBacks'),
  setAutoBackCovers: (enabled) => ipcRenderer.invoke('covers:setAutoBacks', enabled),
  onBoxArtProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('covers:importProgress', listener)
    return () => ipcRenderer.removeListener('covers:importProgress', listener)
  },
  setCoverSources: (values) => ipcRenderer.invoke('covers:setSources', values),
  setEmulatorPreference: (platform, emulatorName) =>
    ipcRenderer.invoke('library:setEmulatorPreference', { platform, emulatorName }),
  setEmulatorPathOverride: (platform, path) =>
    ipcRenderer.invoke('library:setEmulatorPathOverride', { platform, path }),
  setEmulatorLaunchOptions: (platform, options) =>
    ipcRenderer.invoke('library:setEmulatorLaunchOptions', { platform, ...options }),
  chooseEmulatorExecutable: () => ipcRenderer.invoke('emulator:chooseExecutable'),
  checkEmulatorUpdate: (name) => ipcRenderer.invoke('emulator:checkUpdate', { name }),
  openEmulator: (emulatorPath, standaloneArgs) =>
    ipcRenderer.invoke('emulator:open', { emulatorPath, standaloneArgs }),
  openEmulatorFolder: (emulatorPath) => ipcRenderer.invoke('emulator:openFolder', emulatorPath),
  // Fiches de jeu (base LaunchBox, voir main/launchbox-db.js).
  getGameDetails: (game) => ipcRenderer.invoke('details:get', game),
  getLibraryMetadata: (games) => ipcRenderer.invoke('details:library', games),
  searchGameDetails: (platform, query) => ipcRenderer.invoke('details:search', { platform, query }),
  setGameDetailsMatch: (gameId, launchboxId) =>
    ipcRenderer.invoke('details:setMatch', { gameId, launchboxId }),
  getLaunchboxStatus: () => ipcRenderer.invoke('details:status'),
  downloadLaunchbox: () => ipcRenderer.invoke('details:download'),
  onLaunchboxState: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('launchbox:state', listener)
    return () => ipcRenderer.removeListener('launchbox:state', listener)
  },
  // Mise à jour automatique de RetroLib (voir main/updater.js).
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  // Jeux ajoutés ou supprimés dans le dossier RomStation (voir main/library-watcher.js).
  onLibraryChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('library:changed', listener)
    return () => ipcRenderer.removeListener('library:changed', listener)
  },
  // Progression de la décompression pendant un lancement (voir launcher.js / main
  // index.js) : renvoie une fonction de désabonnement, à appeler quand le composant
  // qui écoute est démonté pour éviter d'accumuler des listeners.
  onLaunchProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('launch:progress', listener)
    return () => ipcRenderer.removeListener('launch:progress', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
