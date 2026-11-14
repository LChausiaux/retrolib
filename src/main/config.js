import { app, safeStorage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from './json-store'

const SETTINGS_FILE = join(app.getPath('userData'), 'retrolib-settings.json')

// Emplacements par défaut à essayer si aucun chemin n'a encore été choisi par l'utilisateur.
const DEFAULT_CANDIDATES = ['E:\\RomStation', 'C:\\RomStation', 'D:\\RomStation']

// Écriture atomique avec sauvegarde (voir json-store.js) : un réglage ne peut plus
// être perdu par une coupure de courant pendant l'enregistrement.
function readSettings() {
  const settings = readJsonFile(SETTINGS_FILE, () => ({}))
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
}

function writeSettings(settings) {
  writeJsonFile(SETTINGS_FILE, settings, 2)
}

export function getRomStationPath() {
  const settings = readSettings()
  if (settings.romStationPath && existsSync(settings.romStationPath)) {
    return settings.romStationPath
  }
  for (const candidate of DEFAULT_CANDIDATES) {
    if (existsSync(join(candidate, 'app', 'config', 'romstation.properties'))) {
      return candidate
    }
  }
  return null
}

export function setRomStationPath(path) {
  const settings = readSettings()
  settings.romStationPath = path
  writeSettings(settings)
}

// Overrides : associations plateforme choisies manuellement pour des jeux ambigus
// (typiquement une extension .iso qui peut correspondre à plusieurs consoles).
export function getOverrides() {
  const settings = readSettings()
  return settings.overrides || {}
}

export function setOverride(gameId, platform) {
  const settings = readSettings()
  settings.overrides = settings.overrides || {}
  settings.overrides[gameId] = platform
  writeSettings(settings)
}

// Préférences d'émulateur : quand plusieurs émulateurs sont installés pour la même
// plateforme (ex: Switch -> Eden ou Ryujinx), lequel utiliser par défaut.
export function getEmulatorPreferences() {
  const settings = readSettings()
  return settings.emulatorPreferences || {}
}

export function setEmulatorPreference(platform, emulatorName) {
  const settings = readSettings()
  settings.emulatorPreferences = settings.emulatorPreferences || {}
  settings.emulatorPreferences[platform] = emulatorName
  writeSettings(settings)
}

// Chemin d'émulateur choisi manuellement pour une plateforme (page Émulateurs) :
// prioritaire sur tout ce qui est auto-détecté sur le disque. Sert quand la
// détection automatique se trompe, ou quand l'émulateur est installé ailleurs que
// dans le dossier RomStation (ex: une install Steam, un portable téléchargé à part).
export function getEmulatorPathOverrides() {
  const settings = readSettings()
  return settings.emulatorPathOverrides || {}
}

export function setEmulatorPathOverride(platform, path) {
  const settings = readSettings()
  settings.emulatorPathOverrides = settings.emulatorPathOverrides || {}
  if (path) {
    settings.emulatorPathOverrides[platform] = path
  } else {
    delete settings.emulatorPathOverrides[platform]
  }
  writeSettings(settings)
}

// Réglages avancés par plateforme (page de config dédiée, accessible depuis la page
// Émulateurs) : arguments de ligne de commande personnalisés, en plus du chemin
// personnalisé ci-dessus. launchArgs est utilisé au lancement d'un jeu (voir
// launcher.js) ; standaloneArgs seulement par le bouton "Ouvrir l'émulateur seul"
// (utile pour des émulateurs qui ont besoin d'un flag genre --big-picture,
// --portable, etc. même sans jeu).
export function getEmulatorLaunchOptions() {
  const settings = readSettings()
  return settings.emulatorLaunchOptions || {}
}

export function setEmulatorLaunchOptions(platform, { launchArgs, standaloneArgs }) {
  const settings = readSettings()
  settings.emulatorLaunchOptions = settings.emulatorLaunchOptions || {}
  const current = settings.emulatorLaunchOptions[platform] || {}
  settings.emulatorLaunchOptions[platform] = {
    launchArgs: launchArgs !== undefined ? launchArgs : current.launchArgs || '',
    standaloneArgs: standaloneArgs !== undefined ? standaloneArgs : current.standaloneArgs || ''
  }
  writeSettings(settings)
}

// Jeux marqués en favori (bibliothèque) : affichés en tête de la liste (voir le tri
// dans library.js) et filtrables via la sidebar. Juste une liste d'identifiants,
// sans limite de nombre.
export function getFavorites() {
  const settings = readSettings()
  return settings.favorites || []
}

export function setFavorite(gameId, isFavorite) {
  const settings = readSettings()
  const favorites = new Set(settings.favorites || [])
  if (isFavorite) {
    favorites.add(gameId)
  } else {
    favorites.delete(gameId)
  }
  settings.favorites = [...favorites]
  writeSettings(settings)
}

// Métadonnées de jeu corrigées à la main (titre, année, développeur, éditeur) —
// surchargent ce qui est déduit du catalogue RomStation ou du nom de dossier (voir
// scanner-games.js) : utile pour un jeu ajouté hors catalogue, ou une fiche fausse
// ou incomplète. Un champ vide retombe simplement sur la valeur déduite automatiquement
// (voir library.js), pas besoin d'un bouton "réinitialiser" séparé.
export function getGameMetadataOverrides() {
  const settings = readSettings()
  return settings.gameMetadataOverrides || {}
}

export function setGameMetadataOverride(gameId, { title, year, developer, publisher }) {
  const settings = readSettings()
  settings.gameMetadataOverrides = settings.gameMetadataOverrides || {}
  const current = settings.gameMetadataOverrides[gameId] || {}
  settings.gameMetadataOverrides[gameId] = {
    title: title !== undefined ? title : current.title || '',
    year: year !== undefined ? year : current.year || '',
    developer: developer !== undefined ? developer : current.developer || '',
    publisher: publisher !== undefined ? publisher : current.publisher || ''
  }
  writeSettings(settings)
}

// Cache de la version lue dans un .exe (voir exe-version.js), pour ne pas rescanner
// tout le binaire à chaque rechargement de la bibliothèque — seulement quand le
// fichier a changé (mtime/taille différents, ex. après une mise à jour manuelle de
// l'émulateur).
// À incrémenter à chaque changement du format lu par exe-version.js (nouveaux champs,
// logique de lecture différente...) : sans ça, une entrée mise en cache AVANT un tel
// changement continuerait à être servie indéfiniment tant que le fichier .exe lui-même
// ne change pas de date/taille — vécu en pratique en ajoutant fileVersionString.
const EXE_VERSION_CACHE_SCHEMA = 2

export function getCachedExeVersion(exePath, mtimeMs, size) {
  const settings = readSettings()
  const entry = (settings.exeVersionCache || {})[exePath]
  if (
    entry &&
    entry.schema === EXE_VERSION_CACHE_SCHEMA &&
    entry.mtimeMs === mtimeMs &&
    entry.size === size
  ) {
    return entry.version
  }
  return null
}

export function setCachedExeVersion(exePath, mtimeMs, size, version) {
  const settings = readSettings()
  settings.exeVersionCache = settings.exeVersionCache || {}
  settings.exeVersionCache[exePath] = { schema: EXE_VERSION_CACHE_SCHEMA, mtimeMs, size, version }
  writeSettings(settings)
}

// Sources de jaquettes en ligne (voir cover-sources.js) : libretro-thumbnails ne
// demande rien, mais ScreenScraper (identifiants développeur + compte utilisateur) et
// SteamGridDB (clé d'API) ne fonctionnent qu'avec des identifiants personnels. Les
// mots de passe/clés sont chiffrés au repos via safeStorage (DPAPI sous Windows)
// quand c'est disponible, pour ne pas traîner en clair dans retrolib-settings.json.
const COVER_SECRET_FIELDS = ['ssDevPassword', 'ssPassword', 'steamGridDbKey']
const COVER_SOURCE_FIELDS = ['ssDevId', 'ssDevPassword', 'ssUser', 'ssPassword', 'steamGridDbKey']

function encryptSecret(value) {
  if (!value) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(value).toString('base64')
  }
  return value
}

function decryptSecret(value) {
  if (!value || !value.startsWith('enc:')) return value || ''
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
  } catch {
    return ''
  }
}

export function getCoverSourceSettings() {
  const stored = readSettings().coverSources || {}
  const result = {}
  for (const field of COVER_SOURCE_FIELDS) {
    const raw = stored[field] || ''
    result[field] = COVER_SECRET_FIELDS.includes(field) ? decryptSecret(raw) : raw
  }
  return result
}

export function setCoverSourceSettings(values) {
  const settings = readSettings()
  settings.coverSources = settings.coverSources || {}
  for (const field of COVER_SOURCE_FIELDS) {
    if (values[field] === undefined) continue
    const value = String(values[field] || '').trim()
    settings.coverSources[field] = COVER_SECRET_FIELDS.includes(field)
      ? encryptSecret(value)
      : value
  }
  writeSettings(settings)
}

// Ajout automatique du dos des boîtes (LaunchBox, édition française sinon européenne,
// voir launchbox-db.js) : activé par défaut. Les jeux déjà tentés sont mémorisés avec
// leur date pour ne pas réinterroger la base à chaque lancement (nouvel essai au bout
// de 30 jours, quand la base LaunchBox a pu être complétée).
const AUTO_BACK_RETRY_MS = 30 * 24 * 3600 * 1000

export function getAutoBackCovers() {
  return readSettings().autoBackCovers !== false
}

export function setAutoBackCovers(enabled) {
  const settings = readSettings()
  settings.autoBackCovers = Boolean(enabled)
  writeSettings(settings)
}

export function getRecentBackAttempts() {
  const tried = readSettings().backCoverAttempts || {}
  const now = Date.now()
  return new Set(Object.keys(tried).filter((id) => now - tried[id] < AUTO_BACK_RETRY_MS))
}

export function recordBackAttempts(gameIds) {
  if (!gameIds.length) return
  const settings = readSettings()
  settings.backCoverAttempts = settings.backCoverAttempts || {}
  const now = Date.now()
  for (const id of gameIds) settings.backCoverAttempts[id] = now
  writeSettings(settings)
}

// Fiche LaunchBox choisie à la main pour un jeu (page du jeu, « Ce n'est pas le bon
// jeu ? ») quand le rapprochement automatique par titre se trompe : id LaunchBox, ou
// "none" pour n'afficher aucune fiche. Voir launchbox-db.js.
export function getLaunchboxMatchOverrides() {
  return readSettings().launchboxMatches || {}
}

export function setLaunchboxMatchOverride(gameId, launchboxId) {
  const settings = readSettings()
  settings.launchboxMatches = settings.launchboxMatches || {}
  if (launchboxId) {
    settings.launchboxMatches[gameId] = String(launchboxId)
  } else {
    delete settings.launchboxMatches[gameId]
  }
  writeSettings(settings)
}
