// Lecture en flux du Metadata.xml de la base LaunchBox Games DB (voir launchbox-db.js).
// Module sans dépendance à Electron : testé par Vitest (voir tests/).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
      return Number.isFinite(n) ? String.fromCodePoint(n) : match
    }
    return ENTITIES[code] ?? match
  })
}

export const IMAGE_TYPES = { 'Box - Front': 'front', 'Box - Back': 'back', 'Box - Spine': 'spine' }

// Champs d'un <Game> conservés pour la fiche du jeu (en plus du nom et de la
// plateforme). Le résumé (Overview) peut s'étendre sur plusieurs lignes.
const GAME_FIELDS = new Set([
  'Name',
  'Platform',
  'Overview',
  'Genres',
  'Developer',
  'Publisher',
  'MaxPlayers',
  'Cooperative',
  'ReleaseDate',
  'ReleaseYear',
  'CommunityRating',
  'CommunityRatingCount'
])

// Résumé tronqué au-delà : quelques fiches LaunchBox contiennent des pages entières.
const MAX_OVERVIEW = 4000

const LINE_TAG = /^\s*<(\w+)>([^<]*)<\/\1>\s*$/
const OPEN_TAG = /^\s*<(\w+)>(.*)$/

// Métadonnées compactes d'un jeu LaunchBox (champs vides omis).
export function buildGameMeta(fields) {
  const meta = {}
  const overview = fields.Overview?.trim()
  if (overview) {
    meta.overview =
      overview.length > MAX_OVERVIEW ? overview.slice(0, MAX_OVERVIEW).trimEnd() + '…' : overview
  }
  const genres = (fields.Genres || '')
    .split(';')
    .map((genre) => genre.trim())
    .filter(Boolean)
  if (genres.length) meta.genres = genres
  if (fields.Developer?.trim()) meta.developer = fields.Developer.trim()
  if (fields.Publisher?.trim()) meta.publisher = fields.Publisher.trim()
  const players = Number(fields.MaxPlayers)
  if (Number.isInteger(players) && players > 0) meta.maxPlayers = players
  if (fields.Cooperative === 'true') meta.cooperative = true
  const date = /^\d{4}-\d{2}-\d{2}/.exec(fields.ReleaseDate || '')
  if (date) meta.releaseDate = date[0]
  else if (/^\d{4}$/.test(fields.ReleaseYear || '')) meta.releaseDate = fields.ReleaseYear
  const rating = Number(fields.CommunityRating)
  const ratingCount = Number(fields.CommunityRatingCount)
  if (rating > 0 && ratingCount > 0) {
    meta.rating = Math.round(rating * 10) / 10
    meta.ratingCount = ratingCount
  }
  return meta
}

// Lecture du XML ligne par ligne (le fichier est indenté, un champ par ligne, sauf
// les textes longs qui peuvent contenir des retours à la ligne) : seuls les éléments
// <Game>, <GameAlternateName> et <GameImage> des plateformes voulues nous intéressent.
// stream : itérable asynchrone de Buffer. wantedPlatforms : noms LaunchBox.
// Renvoie { games: Map(id -> { name, platform, meta }), altNames, images }.
export async function parseMetadata(stream, wantedPlatforms, onProgress) {
  const wanted = new Set(wantedPlatforms)
  const games = new Map()
  const altNames = new Map() // id -> [noms]
  const images = new Map() // id -> { front: [[fichier, région]], back: [...], spine: [...] }

  let context = null
  let current = null
  // Champ en cours de lecture sur plusieurs lignes : { tag, text }.
  let pending = null
  let rest = ''
  let bytes = 0

  const setField = (tag, raw) => {
    if (tag === 'DatabaseID') current.id = raw.trim()
    else if (context === 'Game') {
      if (GAME_FIELDS.has(tag)) current.fields[tag] = decodeXml(raw)
    } else if (context === 'GameAlternateName' && tag === 'AlternateName')
      current.name = decodeXml(raw)
    else if (context === 'GameImage' && tag === 'FileName') current.file = raw
    else if (context === 'GameImage' && tag === 'Type') current.type = decodeXml(raw)
    else if (context === 'GameImage' && tag === 'Region') current.region = decodeXml(raw)
  }

  const closeElement = () => {
    if (context === 'Game') {
      const { Name: name, Platform: platform } = current.fields
      if (current.id && name && wanted.has(platform)) {
        games.set(current.id, { name, platform, meta: buildGameMeta(current.fields) })
      }
    } else if (context === 'GameAlternateName') {
      if (current.id && current.name) {
        if (!altNames.has(current.id)) altNames.set(current.id, [])
        altNames.get(current.id).push(current.name)
      }
    } else if (context === 'GameImage') {
      const kind = IMAGE_TYPES[current.type]
      if (kind && current.id && current.file) {
        if (!images.has(current.id)) images.set(current.id, {})
        const entry = images.get(current.id)
        ;(entry[kind] ||= []).push([current.file, current.region || ''])
      }
    }
    context = null
    current = null
    pending = null
  }

  const handleLine = (rawLine) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (pending) {
      const end = line.indexOf(`</${pending.tag}>`)
      if (end === -1) {
        pending.text += '\n' + line
        return
      }
      setField(pending.tag, pending.text + '\n' + line.slice(0, end))
      pending = null
      return
    }
    const trimmed = line.trim()
    if (trimmed === '<Game>' || trimmed === '<GameAlternateName>' || trimmed === '<GameImage>') {
      context = trimmed.slice(1, -1)
      current = { fields: {} }
      return
    }
    if (!context) return
    if (trimmed === `</${context}>`) {
      closeElement()
      return
    }
    const match = LINE_TAG.exec(line)
    if (match) {
      setField(match[1], match[2])
      return
    }
    // Ouverture d'un champ dont le texte continue sur les lignes suivantes.
    const open = OPEN_TAG.exec(line)
    if (open && !open[2].includes('<')) pending = { tag: open[1], text: open[2] }
  }

  // TextDecoder en mode flux : un caractère accentué coupé entre deux morceaux du
  // fichier est recollé correctement (chunk.toString le remplaçait par "�").
  const decoder = new TextDecoder('utf-8')
  for await (const chunk of stream) {
    bytes += chunk.length
    onProgress?.(bytes)
    const text = rest + decoder.decode(chunk, { stream: true })
    const lines = text.split('\n')
    rest = lines.pop()
    for (const line of lines) handleLine(line)
  }
  rest += decoder.decode()
  if (rest) handleLine(rest)

  return { games, altNames, images }
}
