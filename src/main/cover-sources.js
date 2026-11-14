import { app, net } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { getCoverSourceSettings } from './config'
import { titleSimilarity } from './title-match'
import { searchLaunchbox, getLaunchboxState, ensureLaunchboxIndex } from './launchbox-db'

// Recherche de jaquettes en ligne pour la fenêtre "Choisir une jaquette" (page du
// jeu). Trois sources, interrogées en parallèle, résultats fusionnés et triés en
// privilégiant les éditions françaises :
//
// - libretro-thumbnails : gratuit, sans compte. Jaquettes nommées d'après les bases
//   No-Intro/Redump, région dans le nom ("Koudelka (France).png"), y compris des
//   titres français ("Tomb Raider - La Revelation Finale (France)") qui collent
//   directement aux titres du catalogue RomStation. Pas de Switch.
// - ScreenScraper (site français) : jaquettes par région (fr en tête), toutes
//   consoles dont la Switch. Exige des identifiants développeur (à demander sur leur
//   forum) + un compte utilisateur gratuit — sans eux, l'API refuse toute requête.
// - SteamGridDB : jaquettes communautaires (sans notion de région), clé d'API gratuite.
//
// Rien n'est téléchargé tant que l'utilisateur n'a pas choisi : les aperçus sont
// chargés directement par le renderer (voir la CSP de index.html), et seule l'image
// retenue est rapatriée (downloadCoverCandidate) puis rangée comme n'importe quelle
// jaquette choisie à la main (game-cover.js).

const USER_AGENT = 'RetroLib'
const MAX_RESULTS = 48

const LIBRETRO_SYSTEMS = {
  ps1: 'Sony - PlayStation',
  ps2: 'Sony - PlayStation 2',
  ps3: 'Sony - PlayStation 3',
  psp: 'Sony - PlayStation Portable',
  gamecube: 'Nintendo - GameCube',
  wii: 'Nintendo - Wii',
  wiiu: 'Nintendo - Wii U',
  n64: 'Nintendo - Nintendo 64',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  gba: 'Nintendo - Game Boy Advance',
  gb: 'Nintendo - Game Boy',
  gbc: 'Nintendo - Game Boy Color',
  nds: 'Nintendo - Nintendo DS',
  '3ds': 'Nintendo - Nintendo 3DS',
  dreamcast: 'Sega - Dreamcast',
  saturn: 'Sega - Saturn'
}

// Identifiants de systèmes ScreenScraper (systemesListe.php).
const SCREENSCRAPER_SYSTEMS = {
  ps1: 57,
  ps2: 58,
  ps3: 59,
  psp: 61,
  gamecube: 13,
  wii: 16,
  wiiu: 18,
  switch: 225,
  n64: 14,
  snes: 4,
  gba: 12,
  gb: 9,
  gbc: 10,
  nds: 15,
  '3ds': 17,
  dreamcast: 23,
  saturn: 22
}

// Ordre de préférence des régions : France d'abord, puis une édition européenne
// (souvent identique ou multilingue avec le français), puis le reste.
const REGION_PRIORITY = { fr: 0, eu: 1, wor: 2, us: 3, other: 4, jp: 5 }

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await net.fetch(url, {
      ...options,
      headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

// --- libretro-thumbnails -----------------------------------------------------------

const LIBRETRO_BASE = 'https://thumbnails.libretro.com'
const LIBRETRO_INDEX_TTL = 30 * 24 * 3600 * 1000

function libretroCacheFile(platform) {
  const dir = join(app.getPath('userData'), 'cover-cache')
  mkdirSync(dir, { recursive: true })
  return join(dir, `libretro-${platform}.json`)
}

// Liste des jaquettes disponibles pour une console : récupérée depuis l'index HTML du
// dossier (quelques Mo pour la PS1), puis mise en cache 30 jours sur le disque.
async function getLibretroIndex(platform) {
  const cacheFile = libretroCacheFile(platform)
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf-8'))
      if (Date.now() - cached.fetchedAt < LIBRETRO_INDEX_TTL) return cached.names
    } catch {
      // Cache illisible : on le régénère.
    }
  }

  const system = LIBRETRO_SYSTEMS[platform]
  const response = await fetchWithTimeout(
    `${LIBRETRO_BASE}/${encodeURIComponent(system)}/Named_Boxarts/`,
    {},
    60000
  )
  if (!response.ok) throw new Error(`libretro : HTTP ${response.status}`)
  const html = await response.text()
  const names = []
  for (const match of html.matchAll(/href="([^"]+)\.png"/g)) {
    try {
      names.push(decodeURIComponent(match[1]))
    } catch {
      // Nom mal encodé : ignoré.
    }
  }
  writeFileSync(cacheFile, JSON.stringify({ fetchedAt: Date.now(), names }), 'utf-8')
  return names
}

// "Koudelka (Europe) (En,Fr,De) (Disc 1)" -> titre, région, langues, disque, flags.
function parseLibretroName(name) {
  const paren = name.indexOf(' (')
  const base = paren === -1 ? name : name.slice(0, paren)
  const tags = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])
  const regionTag = tags[0] || ''
  const regions = regionTag.split(',').map((r) => r.trim().toLowerCase())
  const languages = tags.find((t) => /^[A-Z][a-z](,[A-Z][a-z])+$|^[A-Z][a-z]$/.test(t)) || ''
  const hasFrench = /\bFr\b/.test(languages)

  let region = 'other'
  if (regions.includes('france')) region = 'fr'
  else if (regions.includes('europe')) region = 'eu'
  else if (regions.includes('world')) region = 'wor'
  else if (regions.includes('usa')) region = 'us'
  else if (regions.includes('japan')) region = 'jp'

  const disc = tags.map((t) => t.match(/^Disc (\d+)/i)).find(Boolean)
  const isAlt = tags.some((t) => /^(demo|beta|proto|sample|kiosk|preview)/i.test(t))
  return {
    base,
    region,
    regionLabel: regionTag,
    hasFrench,
    discNumber: disc ? Number(disc[1]) : null,
    isAlt
  }
}

async function searchLibretro(platform, query) {
  if (!LIBRETRO_SYSTEMS[platform]) return []
  const names = await getLibretroIndex(platform)
  const system = LIBRETRO_SYSTEMS[platform]
  const results = []
  const seenLabels = new Set()
  for (const name of names) {
    const parsed = parseLibretroName(name)
    // Jeux multi-disques : une seule jaquette par édition (celle du disque 1, ou
    // l'entrée sans numéro de disque quand les deux existent).
    if (parsed.discNumber && parsed.discNumber > 1) continue
    const label = name.replace(/ \(Disc \d+\)/i, '')
    if (seenLabels.has(label)) continue
    const score = titleSimilarity(query, parsed.base)
    if (score < 0.5) continue
    seenLabels.add(label)
    const url = `${LIBRETRO_BASE}/${encodeURIComponent(system)}/Named_Boxarts/${encodeURIComponent(name)}.png`
    results.push({
      id: `libretro:${name}`,
      source: 'libretro',
      sourceLabel: 'libretro',
      label,
      region: parsed.region,
      regionLabel: parsed.regionLabel,
      // Une édition européenne avec le français dans ses langues vaut presque une
      // édition française.
      frenchHint: parsed.region === 'fr' || parsed.hasFrench,
      score: parsed.isAlt ? score - 0.3 : score,
      url,
      thumbUrl: url
    })
  }
  return results
}

// --- ScreenScraper -----------------------------------------------------------------

const SS_REGION_MAP = { fr: 'fr', eu: 'eu', wor: 'wor', us: 'us', jp: 'jp', ss: 'wor' }
const SS_REGION_LABELS = {
  fr: 'France',
  eu: 'Europe',
  wor: 'Monde',
  us: 'USA',
  jp: 'Japon',
  ss: 'ScreenScraper'
}

function screenScraperConfigured(settings) {
  return Boolean(settings.ssDevId && settings.ssDevPassword)
}

function pickName(noms = []) {
  for (const region of ['fr', 'eu', 'wor', 'ss', 'us']) {
    const found = noms.find((n) => n.region === region)
    if (found) return found.text
  }
  return noms[0]?.text || ''
}

// face = 'front' : box-2D / box-3D ; face = 'back' : box-2D-back (dos de la boîte à
// plat, par région comme les faces avant). Seule source à proposer des dos.
async function searchScreenScraper(platform, query, settings, face = 'front') {
  const wanted = face === 'back' ? ['box-2D-back'] : ['box-2D', 'box-3D']
  const systemId = SCREENSCRAPER_SYSTEMS[platform]
  if (!systemId) return []
  const params = new URLSearchParams({
    devid: settings.ssDevId,
    devpassword: settings.ssDevPassword,
    softname: USER_AGENT,
    output: 'json',
    systemeid: String(systemId),
    recherche: query
  })
  if (settings.ssUser) params.set('ssid', settings.ssUser)
  if (settings.ssPassword) params.set('sspassword', settings.ssPassword)

  const response = await fetchWithTimeout(
    `https://api.screenscraper.fr/api2/jeuRecherche.php?${params}`,
    {},
    30000
  )
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    // En cas d'erreur, l'API répond en texte brut ("Erreur de login : ...").
    throw new Error(`ScreenScraper : ${text.trim().slice(0, 140) || `HTTP ${response.status}`}`)
  }

  const results = []
  for (const jeu of data?.response?.jeux || []) {
    if (!jeu?.id) continue
    const name = pickName(jeu.noms)
    const score = Math.max(
      titleSimilarity(query, name),
      ...(jeu.noms || []).map((n) => titleSimilarity(query, n.text))
    )
    for (const media of jeu.medias || []) {
      if (!wanted.includes(media.type)) continue
      if (!['png', 'jpg', 'jpeg'].includes(String(media.format).toLowerCase())) continue
      const region = SS_REGION_MAP[media.region] || 'other'
      results.push({
        id: `screenscraper:${jeu.id}:${media.type}:${media.region}`,
        source: 'screenscraper',
        sourceLabel:
          media.type === 'box-3D'
            ? 'ScreenScraper 3D'
            : media.type === 'box-2D-back'
              ? 'ScreenScraper · dos'
              : 'ScreenScraper',
        label: name,
        region,
        regionLabel: SS_REGION_LABELS[media.region] || media.region || '',
        frenchHint: media.region === 'fr',
        // Les boîtes 3D passent après les jaquettes à plat, plus adaptées à la grille.
        score: media.type === 'box-3D' ? score - 0.05 : score,
        url: media.url,
        thumbUrl: `${media.url}&maxwidth=300`
      })
    }
  }
  return results
}

// --- SteamGridDB -------------------------------------------------------------------

async function searchSteamGridDb(query, apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}` }
  const base = 'https://www.steamgriddb.com/api/v2'
  const search = await fetchWithTimeout(
    `${base}/search/autocomplete/${encodeURIComponent(query)}`,
    { headers }
  )
  if (search.status === 401) throw new Error('SteamGridDB : clé d’API refusée')
  if (!search.ok) throw new Error(`SteamGridDB : HTTP ${search.status}`)
  const games = ((await search.json()).data || []).slice(0, 2)

  const results = []
  for (const game of games) {
    const score = titleSimilarity(query, game.name)
    if (score < 0.5) continue
    const grids = await fetchWithTimeout(
      `${base}/grids/game/${game.id}?dimensions=600x900,342x482,660x930&types=static&mimes=image/png,image/jpeg`,
      { headers }
    )
    if (!grids.ok) continue
    for (const grid of ((await grids.json()).data || []).slice(0, 8)) {
      results.push({
        id: `steamgriddb:${grid.id}`,
        source: 'steamgriddb',
        sourceLabel: 'SteamGridDB',
        label: game.name,
        region: 'other',
        regionLabel: '',
        frenchHint: false,
        score: score - 0.1,
        url: grid.url,
        thumbUrl: grid.thumb || grid.url
      })
    }
  }
  return results
}

// --- Fusion ------------------------------------------------------------------------

function regionRank(candidate) {
  if (candidate.frenchHint && candidate.region !== 'fr') return 0.5
  return REGION_PRIORITY[candidate.region] ?? 4
}

// Tri : d'abord la qualité de correspondance du titre (par paliers, pour qu'une
// légère différence de score ne fasse pas passer une édition US devant la française),
// puis la région (France en tête), puis le score exact.
function compareCandidates(a, b) {
  const bucket = (score) => (score >= 0.99 ? 3 : score >= 0.8 ? 2 : score >= 0.6 ? 1 : 0)
  return (
    bucket(b.score) - bucket(a.score) ||
    regionRank(a) - regionRank(b) ||
    b.score - a.score ||
    a.label.localeCompare(b.label)
  )
}

export function getCoverSourcesStatus() {
  const settings = getCoverSourceSettings()
  return {
    libretro: true,
    launchbox: getLaunchboxState(),
    screenscraper: screenScraperConfigured(settings),
    steamgriddb: Boolean(settings.steamGridDbKey)
  }
}

export async function searchCoverCandidates({ platform, query, face = 'front' }) {
  const settings = getCoverSourceSettings()
  const trimmed = String(query || '').trim()
  if (!trimmed) return { candidates: [], errors: [] }

  // Dos de boîte : ni libretro-thumbnails (faces avant, captures, écrans titre) ni
  // SteamGridDB (visuels de vitrine) n'en proposent ; LaunchBox et ScreenScraper, oui.
  const jobs = face === 'back' ? [] : [['libretro', () => searchLibretro(platform, trimmed)]]
  const errors = []
  // LaunchBox : la base (~110 Mo) n'est pas téléchargée depuis cette fenêtre, qui
  // attendrait plusieurs minutes ; on lance le téléchargement en fond et on le signale.
  const launchbox = getLaunchboxState()
  if (launchbox.ready) {
    jobs.push(['LaunchBox', () => searchLaunchbox(platform, trimmed, face)])
  } else {
    if (!launchbox.building) ensureLaunchboxIndex().catch(() => {})
    errors.push(
      'LaunchBox : téléchargement de la base en cours (~110 Mo), relance la recherche dans une à deux minutes.'
    )
  }
  if (screenScraperConfigured(settings)) {
    jobs.push(['ScreenScraper', () => searchScreenScraper(platform, trimmed, settings, face)])
  }
  if (settings.steamGridDbKey && face !== 'back') {
    jobs.push(['SteamGridDB', () => searchSteamGridDb(trimmed, settings.steamGridDbKey)])
  }

  const settled = await Promise.allSettled(jobs.map(([, run]) => run()))
  const candidates = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      candidates.push(...result.value)
    } else {
      const message =
        result.reason?.name === 'AbortError' ? 'délai dépassé' : result.reason?.message
      errors.push(`${jobs[index][0]} : ${message || 'erreur inconnue'}`)
    }
  })

  const seen = new Set()
  const unique = candidates.filter((c) => !seen.has(c.url) && seen.add(c.url))
  unique.sort(compareCandidates)
  return { candidates: unique.slice(0, MAX_RESULTS), errors }
}

// Télécharge l'image retenue dans un fichier temporaire, que setGameCoverImage
// déplacera ensuite dans le dossier "images" du jeu. Seuls PNG et JPEG sont acceptés :
// c'est ce que reconnaît le scan des jaquettes (findCover dans scanner-games.js).
export async function downloadCoverCandidate(url) {
  if (!/^https:\/\//i.test(url)) throw new Error('URL de jaquette invalide')
  const response = await fetchWithTimeout(url, {}, 60000)
  if (!response.ok) throw new Error(`Téléchargement impossible (HTTP ${response.status})`)
  const type = (response.headers.get('content-type') || '').toLowerCase()
  const buffer = Buffer.from(await response.arrayBuffer())

  let ext = null
  if (type.includes('png') || buffer.subarray(0, 4).toString('hex') === '89504e47') ext = '.png'
  else if (
    type.includes('jpeg') ||
    type.includes('jpg') ||
    buffer.subarray(0, 2).toString('hex') === 'ffd8'
  )
    ext = '.jpg'
  if (!ext) throw new Error('Format d’image non pris en charge (PNG ou JPEG uniquement)')

  const tempPath = join(tmpdir(), `retrolib-cover-${Date.now()}${ext}`)
  await writeFile(tempPath, buffer)
  return tempPath
}
