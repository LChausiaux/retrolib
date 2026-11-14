import { app, net } from 'electron'
import { createWriteStream, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { openZipEntryStream } from './zip-extract'
import { prepareTitle, titleSimilarity, strictTitleScore } from './title-match'
import { parseMetadata } from './launchbox-parse'
import { readJsonFile, writeJsonFile } from './json-store'
import { downloadCoverCandidate } from './cover-sources'
import { setGameCoverImage } from './game-cover'

// Base LaunchBox Games DB (gamesdb.launchbox-app.com) : publique, sans compte. Son
// export complet (Metadata.zip, ~110 Mo, un XML de ~500 Mo) liste chaque jeu avec ses
// images par type et par région : faces avant, dos ("Box - Back") et tranches
// ("Box - Spine"). On le télécharge une fois, on n'en garde qu'un index compact limité
// aux consoles gérées par RetroLib (quelques Mo, rafraîchi tous les 30 jours), et
// l'archive est supprimée.
//
// Trois usages : l'import groupé des dos et tranches manquants (Réglages), une source
// de plus dans la fenêtre "Choisir une jaquette" (cover-sources.js), et les fiches de
// jeu (résumé, genres, nombre de joueurs, note : voir "Fiches de jeu" plus bas). Les
// fiches sont rangées à part, un fichier par plateforme, chargé seulement quand on en
// a besoin : l'index des titres et images reste ainsi léger.

const METADATA_URL = 'https://gamesdb.launchbox-app.com/Metadata.zip'
const IMAGE_BASE = 'https://images.launchbox-app.com/'
// 2 : ajout des fiches de jeu (fichiers launchbox-meta-<plateforme>.json).
const INDEX_VERSION = 2
const INDEX_TTL = 30 * 24 * 3600 * 1000

export const LAUNCHBOX_PLATFORMS = {
  ps1: 'Sony Playstation',
  ps2: 'Sony Playstation 2',
  ps3: 'Sony Playstation 3',
  psp: 'Sony PSP',
  gamecube: 'Nintendo GameCube',
  wii: 'Nintendo Wii',
  wiiu: 'Nintendo Wii U',
  switch: 'Nintendo Switch',
  n64: 'Nintendo 64',
  snes: 'Super Nintendo Entertainment System',
  gb: 'Nintendo Game Boy',
  gbc: 'Nintendo Game Boy Color',
  gba: 'Nintendo Game Boy Advance',
  nds: 'Nintendo DS',
  '3ds': 'Nintendo 3DS',
  dreamcast: 'Sega Dreamcast',
  saturn: 'Sega Saturn',
  xbox360: 'Microsoft Xbox 360'
}

// Préférence des régions : France, puis Europe (souvent identique ou multilingue),
// puis le reste de l'Europe, le monde, l'Amérique du Nord et en dernier le Japon.
const REGION_RANK = {
  France: 0,
  Europe: 1,
  World: 2,
  'United Kingdom': 3,
  Germany: 4,
  Spain: 4,
  Italy: 4,
  'The Netherlands': 4,
  Sweden: 4,
  Australia: 5,
  Oceania: 5,
  'North America': 6,
  'United States': 6,
  Canada: 6,
  '': 7,
  Japan: 9
}

const REGION_CODE = {
  France: 'fr',
  Europe: 'eu',
  World: 'wor',
  'North America': 'us',
  'United States': 'us',
  Canada: 'us',
  Japan: 'jp'
}

function regionRank(region) {
  return REGION_RANK[region] ?? 8
}

function cacheDir() {
  const dir = join(app.getPath('userData'), 'cover-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

function indexFile() {
  return join(cacheDir(), 'launchbox-index.json')
}

function metaFile(platform) {
  return join(cacheDir(), `launchbox-meta-${platform}.json`)
}

// --- Construction de l'index -----------------------------------------------------

// Regroupe le résultat de la lecture du XML : jeux par plateforme RetroLib (index de
// rapprochement), images des seuls jeux retenus, et fiches par plateforme.
function splitParsed({ games, altNames, images }) {
  const codeByName = Object.fromEntries(Object.entries(LAUNCHBOX_PLATFORMS).map(([k, v]) => [v, k]))
  const platforms = {}
  const keptImages = {}
  const metaByPlatform = {}
  for (const [id, game] of games) {
    const code = codeByName[game.platform]
    ;(platforms[code] ||= []).push({ id, names: [game.name, ...(altNames.get(id) || [])] })
    if (images.has(id)) keptImages[id] = images.get(id)
    ;(metaByPlatform[code] ||= {})[id] = { name: game.name, ...game.meta }
  }
  return { platforms, images: keptImages, metaByPlatform }
}

let indexPromise = null
let indexCache = null
let buildState = null // { phase: 'download' | 'parse', fraction } pendant la construction
const metaCache = new Map() // plateforme -> { <id LaunchBox>: fiche }

export function getLaunchboxState() {
  if (indexCache) return { ready: true, fetchedAt: indexCache.fetchedAt }
  if (buildState) return { ready: false, building: true, ...buildState }
  return { ready: Boolean(peekIndex()), building: false }
}

// État de la base pour les fiches de jeu : available = index utilisable sans nouveau
// téléchargement ; building (+ phase, fraction) pendant un téléchargement.
export function getLaunchboxStatus() {
  return {
    available: Boolean(indexCache) || Boolean(peekIndex()),
    building: Boolean(buildState),
    phase: buildState?.phase || null,
    fraction: buildState?.fraction ?? null
  }
}

function readIndexFromDisk() {
  const data = readJsonFile(indexFile(), null)
  if (data?.version === INDEX_VERSION && data.platforms && data.images) return data
  // Index absent, illisible ou d'un ancien format : reconstruit.
  return null
}

const buildListeners = new Set()
// Abonnés permanents à l'état de la base (téléchargement, construction, prête) : le
// processus principal relaie ces changements à la fenêtre (voir index.js).
const stateListeners = new Set()

export function onLaunchboxStateChange(listener) {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

function emitBuild() {
  for (const listener of buildListeners) listener(buildState)
  emitState()
}

function emitState() {
  const state = getLaunchboxStatus()
  for (const listener of stateListeners) listener(state)
}

async function buildIndex() {
  const zipPath = join(cacheDir(), 'launchbox-Metadata.zip')
  buildState = { phase: 'download', fraction: 0 }
  emitBuild()
  try {
    const response = await net.fetch(METADATA_URL, { headers: { 'User-Agent': 'RetroLib' } })
    if (!response.ok) throw new Error(`LaunchBox : HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length')) || 0
    let received = 0
    const body = Readable.fromWeb(response.body)
    body.on('data', (chunk) => {
      received += chunk.length
      if (total) {
        buildState = { phase: 'download', fraction: Math.min(received / total, 1) }
        emitBuild()
      }
    })
    await pipeline(body, createWriteStream(zipPath))

    const stream = openZipEntryStream(zipPath, 'Metadata.xml')
    if (!stream) throw new Error('LaunchBox : Metadata.xml absent de l’archive')
    // Taille décompressée inconnue ici sans relire la table : ~520 Mo constatés.
    const expected = 520 * 1024 * 1024
    const parsed = await parseMetadata(stream, Object.values(LAUNCHBOX_PLATFORMS), (bytes) => {
      buildState = { phase: 'parse', fraction: Math.min(bytes / expected, 0.99) }
      emitBuild()
    })
    const { platforms, images, metaByPlatform } = splitParsed(parsed)
    const fetchedAt = Date.now()
    // Fiches d'abord : l'index n'est écrit qu'une fois tout le reste en place, un index
    // présent sur le disque garantit donc des fiches complètes.
    for (const code of Object.keys(LAUNCHBOX_PLATFORMS)) {
      writeJsonFile(metaFile(code), { fetchedAt, games: metaByPlatform[code] || {} })
    }
    const index = { version: INDEX_VERSION, fetchedAt, platforms, images }
    writeJsonFile(indexFile(), index)
    return index
  } finally {
    buildState = null
    try {
      unlinkSync(zipPath)
    } catch {
      // Archive déjà absente.
    }
  }
}

// Index LaunchBox prêt à l'emploi : depuis la mémoire, sinon depuis le disque, sinon
// téléchargé et construit. Un index de plus de 30 jours sert tel quel pendant qu'une
// version à jour se construit en fond. Un seul téléchargement à la fois.
export function ensureLaunchboxIndex({ onProgress, refresh = false } = {}) {
  if (indexCache && !refresh) return Promise.resolve(indexCache)
  if (!refresh && !indexPromise) {
    const onDisk = readIndexFromDisk()
    if (onDisk) {
      indexCache = onDisk
      if (Date.now() - onDisk.fetchedAt > INDEX_TTL) rebuild().catch(() => {})
      return Promise.resolve(onDisk)
    }
  }
  return rebuild(onProgress)
}

function rebuild(onProgress) {
  if (onProgress) buildListeners.add(onProgress)
  if (!indexPromise) {
    indexPromise = buildIndex()
      .then((index) => {
        indexCache = index
        diskIndexRejected = false
        metaCache.clear()
        return index
      })
      .finally(() => {
        indexPromise = null
        buildListeners.clear()
        emitState()
      })
  }
  return indexPromise
}

// --- Rapprochement ----------------------------------------------------------------

function bestImage(list) {
  if (!list?.length) return null
  return [...list].sort((a, b) => regionRank(a[1]) - regionRank(b[1]))[0]
}

// Dos de boîte : le premier dos français, sinon européen, et rien d'autre (un dos
// américain ou japonais, dans une autre langue et souvent avec d'autres mentions, ne
// correspond pas aux boîtes de la bibliothèque ; la boîte 3D génère alors le sien).
const BACK_REGIONS = ['France', 'Europe']

function bestBack(list) {
  for (const region of BACK_REGIONS) {
    const found = list?.find((image) => image[1] === region)
    if (found) return found
  }
  return null
}

function imageUrl(file) {
  return IMAGE_BASE + encodeURIComponent(file)
}

// Titres LaunchBox d'une plateforme préparés pour le rapprochement (voir
// title-match.js: prepareTitle), avec un index mot -> jeux : seuls les jeux qui
// partagent au moins un mot avec le titre cherché sont comparés, ce qui rend le
// rapprochement de toute la bibliothèque quasi instantané.
const preparedCache = new WeakMap() // index -> Map(plateforme -> { entries, byToken })

function preparedPlatform(index, platform) {
  let perIndex = preparedCache.get(index)
  if (!perIndex) {
    perIndex = new Map()
    preparedCache.set(index, perIndex)
  }
  let prepared = perIndex.get(platform)
  if (!prepared) {
    const entries = (index.platforms[platform] || []).map((game) => ({
      game,
      names: game.names.map(prepareTitle)
    }))
    const byToken = new Map()
    entries.forEach((entry, i) => {
      for (const name of entry.names) {
        for (const token of name.tokens) {
          if (!byToken.has(token)) byToken.set(token, new Set())
          byToken.get(token).add(i)
        }
      }
    })
    prepared = { entries, byToken }
    perIndex.set(platform, prepared)
  }
  return prepared
}

// Jeux LaunchBox de la plateforme qui ressemblent au titre, du plus proche au moins
// proche. strict : numéros identiques exigés (rapprochement automatique).
function findMatches(index, platform, title, { strict, minScore, limit }) {
  const { entries, byToken } = preparedPlatform(index, platform)
  const query = prepareTitle(title)
  const candidates = new Set()
  for (const token of query.tokens) {
    for (const i of byToken.get(token) || []) candidates.add(i)
  }
  const scoreFn = strict ? strictTitleScore : titleSimilarity
  const matches = []
  for (const i of candidates) {
    const { game, names } = entries[i]
    let score = 0
    for (const name of names) score = Math.max(score, scoreFn(query, name))
    if (score >= minScore) matches.push({ game, score })
  }
  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, limit)
}

// Titre nettoyé pour le rapprochement : sans les mentions entre parenthèses ou
// crochets ajoutées par les dumps ("(Undub)", "(NTSC)", "[480p]").
function cleanTitle(title) {
  return String(title)
    .replace(/\s*[([][^)\]]*[)\]]/g, ' ')
    .trim()
}

// Meilleur jeu LaunchBox pour un jeu de la bibliothèque, pour l'import automatique :
// correspondance quasi exacte, et parmi les ex æquo celui qui a le plus d'images.
function autoMatch(index, platform, title) {
  const query = cleanTitle(title)
  let matches = findMatches(index, platform, query, { strict: true, minScore: 0.85, limit: 6 })
  // Numérotation propre au catalogue RomStation devant un sous-titre ("Legacy of Kain
  // 2 : Soul Reaver", "The Legend of Spyro 08 : The Eternal Night") : sans ces
  // numéros, le titre doit correspondre exactement à celui de LaunchBox.
  if (!matches.length && query.includes(':')) {
    const withoutNumbers = query.replace(/\b\d+\b/g, ' ')
    matches = findMatches(index, platform, withoutNumbers, {
      strict: false,
      minScore: 0.99,
      limit: 6
    })
  }
  if (!matches.length) return null
  const top = matches[0].score
  const tied = matches.filter((m) => top - m.score < 0.001)
  const richness = (m) => {
    const img = index.images[m.game.id] || {}
    return (img.back ? 2 : 0) + (img.spine ? 1 : 0)
  }
  tied.sort((a, b) => richness(b) - richness(a))
  return tied[0].game
}

// Source "LaunchBox" de la fenêtre de choix de jaquette (cover-sources.js).
export async function searchLaunchbox(platform, query, face = 'front') {
  if (!LAUNCHBOX_PLATFORMS[platform]) return []
  const index = await ensureLaunchboxIndex()
  const results = []
  for (const { game, score } of findMatches(index, platform, query, {
    strict: false,
    minScore: 0.5,
    limit: 4
  })) {
    for (const [file, region] of index.images[game.id]?.[face] || []) {
      const code = REGION_CODE[region] || 'other'
      results.push({
        id: `launchbox:${file}`,
        source: 'launchbox',
        sourceLabel: face === 'back' ? 'LaunchBox · dos' : 'LaunchBox',
        label: game.names[0],
        region: code,
        regionLabel: region,
        frenchHint: region === 'France',
        score,
        url: imageUrl(file),
        thumbUrl: imageUrl(file)
      })
    }
  }
  return results
}

// --- Import groupé ------------------------------------------------------------------

let bulkCancelled = false

export function cancelBulkImport() {
  bulkCancelled = true
}

// Récupère le dos et la tranche de chaque jeu qui n'en a pas encore. games : [{ id,
// title, platform, folderPath, romPath, hasBack, hasSpine }]. Les jeux sans dossier
// dédié (rom isolée) sont ignorés : leur créer un dossier déplacerait la rom, ce qui
// changerait leur identifiant (favoris, temps de jeu).
let bulkRunning = false

// options.backsOnly : seulement les dos (ajout automatique au démarrage).
export async function importMissingBoxArt(games, onProgress, { backsOnly = false } = {}) {
  if (bulkRunning) throw new Error('Une récupération des dos et tranches est déjà en cours.')
  bulkRunning = true
  try {
    return await runImport(games, onProgress, backsOnly)
  } finally {
    bulkRunning = false
  }
}

async function runImport(games, onProgress, backsOnly) {
  bulkCancelled = false
  const report = {
    total: 0,
    backs: 0,
    spines: 0,
    unmatched: 0,
    noFolder: 0,
    errors: 0,
    cancelled: false,
    // Jeux examinés jusqu'au bout (trouvés ou non), hors erreurs de téléchargement.
    attempted: []
  }
  const progress = (extra) => onProgress?.({ ...report, ...extra })

  const index = await ensureLaunchboxIndex({
    onProgress: (state) => progress({ phase: state.phase, fraction: state.fraction })
  })

  const todo = []
  for (const game of games) {
    if (game.hasBack && (game.hasSpine || backsOnly)) continue
    if (!game.platform || !LAUNCHBOX_PLATFORMS[game.platform]) continue
    if (!game.folderPath) {
      report.noFolder++
      continue
    }
    todo.push(game)
  }
  report.total = todo.length

  let done = 0
  const queue = [...todo]
  const worker = async () => {
    while (queue.length && !bulkCancelled) {
      const game = queue.shift()
      try {
        const match = autoMatch(index, game.platform, game.title)
        if (!match) {
          report.unmatched++
          report.attempted.push(game.id)
        } else {
          const images = index.images[match.id] || {}
          const target = { folderPath: game.folderPath, romPath: game.romPath }
          const back = !game.hasBack && bestBack(images.back)
          const spine = !backsOnly && !game.hasSpine && bestImage(images.spine)
          if (back) {
            setGameCoverImage(target, await downloadCoverCandidate(imageUrl(back[0])), 'back')
            report.backs++
          }
          if (spine) {
            setGameCoverImage(target, await downloadCoverCandidate(imageUrl(spine[0])), 'spine')
            report.spines++
          }
          if (!back && !spine) report.unmatched++
          report.attempted.push(game.id)
        }
      } catch {
        report.errors++
      }
      done++
      progress({ phase: 'images', done, current: game.title })
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  report.cancelled = bulkCancelled
  return report
}

// --- Fiches de jeu ------------------------------------------------------------------
//
// Résumé, genres, nombre de joueurs, date de sortie et note de la communauté, tirés de
// la base LaunchBox (textes en anglais). Rien n'est téléchargé ici : sans base sur le
// disque, la fiche propose de la récupérer (downloadLaunchboxIndex).

// Index sur le disque refusé (absent, ancien format) : on ne le relit pas à chaque
// appel, seulement après une nouvelle construction.
let diskIndexRejected = false

// Index utilisable tout de suite (mémoire, sinon disque), sans téléchargement.
function peekIndex() {
  if (indexCache) return indexCache
  if (indexPromise || diskIndexRejected) return null
  const onDisk = readIndexFromDisk()
  if (!onDisk) {
    diskIndexRejected = true
    return null
  }
  indexCache = onDisk
  // Index de plus de 30 jours : servi tel quel, rafraîchi en fond.
  if (Date.now() - onDisk.fetchedAt > INDEX_TTL) rebuild().catch(() => {})
  return onDisk
}

// Télécharge et construit la base si elle manque (bouton de la fiche du jeu).
export async function downloadLaunchboxIndex() {
  diskIndexRejected = false
  await ensureLaunchboxIndex()
  return getLaunchboxStatus()
}

function platformMeta(platform) {
  if (!metaCache.has(platform)) {
    metaCache.set(platform, readJsonFile(metaFile(platform), null)?.games || {})
  }
  return metaCache.get(platform)
}

// Jeu LaunchBox correspondant à un jeu de la bibliothèque : choix manuel (override :
// id LaunchBox, ou "none" pour « aucun ») sinon rapprochement automatique.
function resolveMatch(index, game, override) {
  if (override === 'none') return null
  if (override) {
    const chosen = (index.platforms[game.platform] || []).find((entry) => entry.id === override)
    if (chosen) return chosen
  }
  return autoMatch(index, game.platform, game.title)
}

// Fiche complète d'un jeu. game : { title, platform }.
// status : 'unsupported' (plateforme absente de LaunchBox), 'no-index' (base pas
// encore téléchargée), 'not-found' (aucune correspondance) ou 'ready'.
export function getGameDetails(game, override) {
  if (!game.platform || !LAUNCHBOX_PLATFORMS[game.platform]) return { status: 'unsupported' }
  const index = peekIndex()
  if (!index) return { status: 'no-index', ...getLaunchboxStatus() }
  const match = resolveMatch(index, game, override)
  if (!match) return { status: 'not-found', overridden: Boolean(override) }
  const meta = platformMeta(game.platform)[match.id] || {}
  return {
    status: 'ready',
    overridden: Boolean(override),
    match: { id: match.id, name: match.names[0] },
    details: meta
  }
}

// Résumé de toute la bibliothèque pour le filtre par genre : genres et nombre de
// joueurs par jeu. games : [{ id, title, platform }], overrides : { gameId: choix }.
export function getLibraryMetadata(games, overrides = {}) {
  const index = peekIndex()
  if (!index) return { available: false, byGame: {} }
  const byGame = {}
  for (const game of games) {
    if (!game.platform || !LAUNCHBOX_PLATFORMS[game.platform]) continue
    const match = resolveMatch(index, game, overrides[game.id])
    if (!match) continue
    const meta = platformMeta(game.platform)[match.id]
    if (!meta) continue
    byGame[game.id] = {
      genres: meta.genres || [],
      maxPlayers: meta.maxPlayers || null,
      rating: meta.rating || null
    }
  }
  return { available: true, byGame }
}

// Candidats proposés quand le rapprochement automatique s'est trompé (« Ce n'est pas
// le bon jeu ? »), du plus proche au moins proche.
export function searchLaunchboxGames(platform, query) {
  const index = peekIndex()
  if (!index || !LAUNCHBOX_PLATFORMS[platform] || !String(query || '').trim()) return []
  const meta = platformMeta(platform)
  return findMatches(index, platform, cleanTitle(query), {
    strict: false,
    minScore: 0.3,
    limit: 12
  }).map(({ game }) => ({
    id: game.id,
    name: game.names[0],
    releaseDate: meta[game.id]?.releaseDate || null,
    developer: meta[game.id]?.developer || null
  }))
}
