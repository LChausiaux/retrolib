import { basename, resolve, sep } from 'path'
import { stat as fsStat } from 'fs/promises'
import { statSync } from 'fs'
import { readRomStationConfig } from './romstation-config'
import { scanGamesDirectory } from './scanner-games'
import { scanInstalledEmulators } from './scanner-emulators'
import { isExtracted } from './extraction'
import { readExeVersion } from './exe-version'
import { EMULATOR_UPDATE_SOURCES } from './emulator-updates'
import { PLATFORM_EMULATORS, PLATFORM_LABELS } from './platforms'
import { libraryFingerprint } from './library-watcher'
import {
  getOverrides,
  getEmulatorPreferences,
  getEmulatorPathOverrides,
  getEmulatorLaunchOptions,
  getFavorites,
  getGameMetadataOverrides,
  getIgnoredPaths,
  getCachedExeVersion,
  setCachedExeVersion
} from './config'

// Lecture de version mise en cache par chemin+mtime+taille (voir config.js) : évite
// de rescanner tout le binaire (potentiellement plusieurs centaines de Mo) à chaque
// rechargement de la bibliothèque, seulement quand l'exe a effectivement changé.
async function resolveInstalledVersion(exePath) {
  if (!exePath) return null
  let stat
  try {
    stat = await fsStat(exePath)
  } catch {
    return null
  }
  const cached = getCachedExeVersion(exePath, stat.mtimeMs, stat.size)
  if (cached) return cached
  const version = await readExeVersion(exePath)
  setCachedExeVersion(exePath, stat.mtimeMs, stat.size, version)
  return version
}

// Versions installées des émulateurs, lues à part de buildLibrary : sur un cache froid
// (premier lancement, émulateur mis à jour, exe sans version lisible) ça demande de
// scanner des exe de plusieurs dizaines de Mo, ce qui retardait l'affichage de toute la
// bibliothèque. Le renderer affiche donc d'abord la bibliothèque (installedVersion à
// null, versionPending à true), puis appelle ceci en arrière-plan et complète la page
// Émulateurs une fois les versions connues. Un seul scan par chemin, même quand l'exe
// apparaît à la fois dans "detected" et comme émulateur actif. Séquentiel : pas la
// peine de lire plusieurs gros binaires en parallèle sur le même disque.
export async function resolveEmulatorVersions(exePaths) {
  const versions = {}
  for (const exePath of new Set(exePaths)) {
    versions[exePath] = await resolveInstalledVersion(exePath)
  }
  return versions
}

// Pour une plateforme donnée, renvoie le nom de l'émulateur auto-détecté à utiliser :
// la préférence choisie par l'utilisateur si elle est installée, sinon le premier
// émulateur candidat trouvé sur le disque (ordre de PLATFORM_EMULATORS). Le chemin
// personnalisé (page Émulateurs) est traité séparément et prioritaire — voir
// buildEmulatorStatus ci-dessous.
function resolveEmulatorName(platform, installedEmulators, preferences) {
  if (!platform) return null
  const candidates = PLATFORM_EMULATORS[platform] || []
  const preferred = preferences[platform]
  if (preferred && candidates.includes(preferred) && installedEmulators[preferred]) {
    return preferred
  }
  return candidates.find((name) => installedEmulators[name]) || null
}

// Construit, pour chaque plateforme connue, l'état complet de sa configuration
// d'émulateur : ce qui est détecté sur le disque, la préférence choisie s'il y en a
// plusieurs, et le chemin personnalisé éventuel — utilisé par la page "Émulateurs"
// (gestion façon RomStation) et pour résoudre l'émulateur réellement utilisé par jeu.
function buildEmulatorStatus(installedEmulators, preferences, pathOverrides, launchOptions) {
  return Object.entries(PLATFORM_EMULATORS).map(([platform, candidates]) => {
    const detected = candidates
      .filter((name) => installedEmulators[name])
      .map((name) => {
        const path = installedEmulators[name]
        return {
          name,
          path,
          // Complétée plus tard par le renderer, voir resolveEmulatorVersions.
          installedVersion: null,
          versionPending: true,
          hasUpdateCheck: Boolean(EMULATOR_UPDATE_SOURCES[name])
        }
      })
    const autoName = resolveEmulatorName(platform, installedEmulators, preferences)
    const overridePath = pathOverrides[platform] || null
    const options = launchOptions[platform] || {}

    const activeName = overridePath ? basename(overridePath) : autoName
    const activePath = overridePath || (autoName ? installedEmulators[autoName] : null)

    return {
      platform,
      label: PLATFORM_LABELS[platform] || platform,
      candidates,
      detected,
      preference: preferences[platform] || null,
      overridePath,
      activeName,
      activePath,
      launchable: Boolean(activePath),
      // Version installée (lue dans l'exe, voir exe-version.js) ; hasUpdateCheck
      // indique si cet émulateur a une source de mise à jour connue (voir la table en
      // dur dans emulator-updates.js) — le vrai check se fait à la demande côté
      // renderer (emulator:checkUpdate), jamais d'appel réseau ici au simple scan.
      // La version n'est pas lue ici mais en arrière-plan après l'affichage de la
      // bibliothèque (voir resolveEmulatorVersions) : versionPending le signale.
      installedVersion: null,
      versionPending: Boolean(activePath),
      hasUpdateCheck: Boolean(activeName && EMULATOR_UPDATE_SOURCES[activeName]),
      // Réglages avancés (page de config dédiée) : arguments de lancement custom, voir
      // config.js / launcher.js.
      launchArgs: options.launchArgs || '',
      standaloneArgs: options.standaloneArgs || ''
    }
  })
}

function coverVersion(coverPath) {
  try {
    return '?v=' + Math.round(statSync(coverPath).mtimeMs)
  } catch {
    return ''
  }
}

function coverUrlFor(path) {
  return path ? 'retrolib-cover:' + encodeURIComponent(path) + coverVersion(path) : null
}

// Chemin ignoré (voir config.js: getIgnoredPaths) : le dossier ou fichier lui-même,
// ou tout ce qui se trouve dessous. Comparaison insensible à la casse (Windows).
function isUnderIgnored(path, ignored) {
  if (!path) return false
  const target = resolve(path).toLowerCase()
  return ignored.some((p) => target === p || target.startsWith(p + sep))
}

export function buildLibrary(installRoot) {
  const { gamesPath, emulatorsPath } = readRomStationConfig(installRoot)
  const rawGames = scanGamesDirectory(gamesPath)
  const ignoredPaths = getIgnoredPaths()
  const ignored = ignoredPaths.map((p) => resolve(p).toLowerCase())
  const visibleGames = rawGames.filter(
    (game) => !isUnderIgnored(game.folderPath || game.romPath, ignored)
  )
  const installedEmulators = scanInstalledEmulators(emulatorsPath)
  const overrides = getOverrides()
  const emulatorPreferences = getEmulatorPreferences()
  const emulatorPathOverrides = getEmulatorPathOverrides()
  const emulatorLaunchOptions = getEmulatorLaunchOptions()
  const favorites = new Set(getFavorites())
  const metadataOverrides = getGameMetadataOverrides()
  const emulatorStatus = buildEmulatorStatus(
    installedEmulators,
    emulatorPreferences,
    emulatorPathOverrides,
    emulatorLaunchOptions
  )
  const statusByPlatform = Object.fromEntries(
    emulatorStatus.map((entry) => [entry.platform, entry])
  )

  const games = visibleGames.map((game) => {
    const platform = game.platform || overrides[game.id] || null
    const status = platform ? statusByPlatform[platform] : null
    // Métadonnées corrigées à la main (page du jeu, voir config.js) : un champ laissé
    // vide dans l'override retombe simplement sur la valeur déduite automatiquement.
    const metaOverride = metadataOverrides[game.id] || {}
    return {
      ...game,
      platform,
      title: metaOverride.title || game.title,
      year: metaOverride.year || game.year || null,
      developer: metaOverride.developer || game.developer || null,
      publisher: metaOverride.publisher || game.publisher || null,
      // Jeu multi-disque (files/<id1>, files/<id2>... un sous-dossier par disque, voir
      // scanner-games.js) : l'extraction des zips et la génération du .m3u de lancement
      // se font à la demande dans launcher.js (jamais ici, au scan — sinon rescanner la
      // bibliothèque déclencherait l'extraction de tous les jeux d'un coup).
      discCount:
        Array.isArray(game.discPaths) && game.discPaths.length > 1 ? game.discPaths.length : 1,
      // Zip(s) RomStation déjà décompressé(s) à côté (voir extraction.js) : permet à la
      // page du jeu de proposer de supprimer une extraction ratée.
      extracted: isExtracted(game),
      emulatorName: status?.activeName || null,
      emulatorPath: status?.activePath || null,
      // Arguments de lancement personnalisés pour cet émulateur (page de config
      // dédiée) : voir launcher.js pour la façon dont ils sont combinés au chemin de
      // la rom.
      emulatorLaunchArgs: status?.launchArgs || '',
      launchable: Boolean(status?.activePath),
      emulatorOverridden: Boolean(status?.overridePath),
      // Favori (bibliothèque) : affiché en tête de liste, voir le tri ci-dessous.
      favorite: favorites.has(game.id),
      // On ne construit PAS une URL file:// ici : Electron bloque le chargement de
      // file:// depuis une page servie en http (mode dev, serveur Vite), même si la
      // CSP l'autorise. On encode donc le chemin brut tel quel (encodeURIComponent,
      // une seule fois, sans "//") comme partie opaque du schéma personnalisé
      // "retrolib-cover", pour éviter que Chromium ne le parse comme un
      // host/autorité (ce qui casserait la lettre de lecteur Windows, ex. "E:").
      // Le processus principal (voir index.js) le redécode et reconstruit alors la
      // vraie URL file:// via pathToFileURL avant de la lire avec net.fetch, ce qui
      // n'est pas soumis à cette restriction. En build de prod (chargé en file://),
      // ça fonctionne tout aussi bien.
      // "?v=<date de modif>" : une jaquette remplacée garde souvent le même nom
      // (images/cover.png), Chromium resservirait sinon l'ancienne depuis son cache.
      // Le "?" ne peut pas venir du chemin lui-même (encodé en %3F), le gestionnaire
      // du protocole (index.js) coupe simplement l'URL dessus.
      coverUrl: coverUrlFor(game.coverPath),
      // Dos de la boîte (images/back.*, voir game-cover.js) : utilisé par la boîte 3D ;
      // sans lui, le dos est généré à partir de la face avant (box3d.js côté renderer).
      backCoverUrl: coverUrlFor(game.backCoverPath),
      // Tranche (images/spine.*) : sinon générée avec le titre.
      spineCoverUrl: coverUrlFor(game.spineCoverPath)
    }
  })

  // Favoris en tête, puis ordre alphabétique — ce tri s'applique une seule fois ici
  // et se propage donc automatiquement à toute vue filtrée côté renderer (recherche,
  // filtre par plateforme...), pas seulement à la liste complète.
  games.sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title, 'fr')
  )

  // Plateformes pour lesquelles plusieurs émulateurs installés sont candidats : c'est
  // uniquement pour celles-là que le sélecteur rapide de la page du jeu a un choix à
  // proposer (la page Émulateurs, elle, liste tout, voir emulatorStatus ci-dessus).
  const platformsWithChoice = emulatorStatus
    .filter((entry) => entry.detected.length > 1)
    .map((entry) => ({
      platform: entry.platform,
      options: entry.detected.map((d) => d.name),
      current: entry.preference || entry.detected[0]?.name
    }))

  // Nombre de jeux par plateforme (affiché sur chaque ligne de la page Émulateurs :
  // "48 jeux" si prêt, "31 jeux en attente" sinon).
  const gameCountByPlatform = {}
  for (const game of games) {
    if (game.platform) {
      gameCountByPlatform[game.platform] = (gameCountByPlatform[game.platform] || 0) + 1
    }
  }
  const emulatorStatusWithCounts = emulatorStatus.map((entry) => ({
    ...entry,
    gameCount: gameCountByPlatform[entry.platform] || 0
  }))

  return {
    games,
    // Dossier des jeux et empreinte du scan : surveillance des ajouts (voir
    // library-watcher.js).
    gamesPath,
    fingerprint: libraryFingerprint(rawGames),
    ignoredPaths,
    installedEmulators,
    platformsWithChoice,
    emulatorStatus: emulatorStatusWithCounts
  }
}
