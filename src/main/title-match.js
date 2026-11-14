// Rapprochement de titres de jeux entre sources (catalogue RomStation, noms de
// fichiers libretro, bases ScreenScraper / LaunchBox) : insensible aux accents, à la
// ponctuation (" : " vs " - "), à l'ordre des mots ("Legend of Zelda, The") et aux
// chiffres romains ("Final Fantasy VII" = "Final Fantasy 7").

// "and"/"et" ignorés : libretro remplace "&" par "_" dans ses noms de fichiers.
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'le',
  'la',
  'les',
  'l',
  'un',
  'une',
  'et',
  'of',
  'de',
  'du',
  'des'
])

const ROMAN = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
  xiii: '13'
}

export function normalizeTokens(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token && !STOPWORDS.has(token))
    .map((token) => ROMAN[token] || token)
}

// Titre préparé une fois pour toutes (mots normalisés, numéros) : rapprocher toute la
// bibliothèque de la base LaunchBox compare chaque jeu à des milliers de titres, on
// évite ainsi de renormaliser les mêmes titres à chaque comparaison.
export function prepareTitle(text) {
  const tokens = normalizeTokens(text)
  return {
    tokens: new Set(tokens),
    numbers: tokens
      .filter((token) => /^\d+$/.test(token) && token.length < 4)
      .sort()
      .join(',')
  }
}

function prepared(value) {
  return typeof value === 'string' || value == null ? prepareTitle(value) : value
}

// Coefficient de Dice sur les mots (0 à 1). Accepte des titres bruts ou préparés.
export function titleSimilarity(a, b) {
  const ta = prepared(a).tokens
  const tb = prepared(b).tokens
  if (!ta.size || !tb.size) return 0
  let common = 0
  for (const token of ta) if (tb.has(token)) common++
  return (2 * common) / (ta.size + tb.size)
}

// Version stricte pour un rapprochement automatique (sans validation humaine) : les
// numéros doivent être identiques, sinon "Dino Crisis" (0,8 de similarité avec
// "Dino Crisis 2") récupérerait les images de la suite.
export function strictTitleScore(a, b) {
  const pa = prepared(a)
  const pb = prepared(b)
  if (pa.numbers !== pb.numbers) return 0
  return titleSimilarity(pa, pb)
}
