import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// Boîtes de jeu en 3D (Three.js) : un pavé aux dimensions réelles du boîtier de la
// console, habillé de la jaquette avant, du dos (images/back.*, sinon généré) et de
// faces générées (tranche avec le titre, dessus/dessous/ouverture dans la matière du
// boîtier).
//
// Deux usages :
// - vue étagère (GameBox3D.vue) : des centaines de boîtes. Un seul contexte WebGL
//   partagé (les navigateurs en limitent le nombre à ~16) rend chaque boîte puis la
//   recopie dans le <canvas> 2D de sa tuile ; seule la boîte survolée est re-rendue,
//   image par image, pendant son inclinaison.
// - fiche du jeu (BoxViewer3D.vue) : une boîte manipulable à la souris, dans son
//   propre renderer (createViewerRenderer).

// --- Formats de boîtiers -------------------------------------------------------------

// Dimensions par défaut en mm (largeur, hauteur, épaisseur), type de boîtier et
// couleur du plastique pour les boîtiers DVD / Blu-ray / cartouche. Proportions
// vérifiées sur les scans LaunchBox (12 jeux par console) ; quand la jaquette du jeu
// est connue, ses propres proportions priment (voir resolveFormat) : une même console
// peut avoir des boîtes différentes selon la région (Saturn PAL en boîte longue, N64
// japonaise à la française…).
export const BOX_FORMATS = {
  jewel: { w: 142, h: 125, d: 10, kind: 'jewel' },
  jewelMulti: { w: 142, h: 125, d: 24, kind: 'jewel' },
  dvdBlack: { w: 135, h: 190, d: 14, kind: 'keep', rim: '#141416' },
  dvdWhite: { w: 135, h: 190, d: 14, kind: 'keep', rim: '#D6D6DA', light: true },
  dvdBlue: { w: 135, h: 190, d: 14, kind: 'keep', rim: '#2F79B8' },
  dvdGreen: { w: 135, h: 190, d: 14, kind: 'keep', rim: '#4E7A52' },
  bluray: { w: 146, h: 170, d: 14, kind: 'keep', rim: '#33506F' },
  switch: { w: 105, h: 170, d: 11, kind: 'keep', rim: '#A6403E' },
  // Boîtiers DS / 3DS : plus larges que hauts (jaquettes à ~1,12 de ratio).
  ds: { w: 137, h: 123, d: 15, kind: 'keep', rim: '#C9CBD0', light: true },
  n3ds: { w: 137, h: 123, d: 13, kind: 'keep', rim: '#C9CBD0', light: true },
  umd: { w: 105, h: 175, d: 15, kind: 'keep', rim: '#1E1E22' },
  carton: { w: 180, h: 128, d: 38, kind: 'carton' },
  cartonSmall: { w: 128, h: 128, d: 28, kind: 'carton' }
}

const PLATFORM_FORMAT = {
  ps1: 'jewel',
  saturn: 'jewel',
  dreamcast: 'jewel',
  ps2: 'dvdBlack',
  gamecube: 'dvdBlack',
  wii: 'dvdWhite',
  wiiu: 'dvdBlue',
  xbox360: 'dvdGreen',
  ps3: 'bluray',
  switch: 'switch',
  nds: 'ds',
  '3ds': 'n3ds',
  psp: 'umd',
  snes: 'carton',
  n64: 'carton',
  gb: 'cartonSmall',
  gbc: 'cartonSmall',
  gba: 'cartonSmall'
}

export function formatFor(game) {
  if (game.platform === 'ps1' && game.discCount > 1) return BOX_FORMATS.jewelMulti
  return BOX_FORMATS[PLATFORM_FORMAT[game.platform]] || BOX_FORMATS.dvdBlack
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

// Format effectif d'une boîte, d'après ses vraies images :
// - proportions de la jaquette avant. Boîtier CD : livret carré (12 × 12 cm) posé à
//   droite de la charnière, ou boîte longue (Saturn PAL…) si la jaquette est haute.
//   Autres boîtiers : même surface que le format par défaut, au ratio de la jaquette
//   (dans une marge raisonnable, sauf les boîtes carton, à l'italienne ou non) ;
// - épaisseur d'après le scan de la tranche ;
// - bord portant la tranche : le côté gauche, ou le dessus pour une boîte carton à
//   l'italienne dont le scan de tranche a la longueur de la largeur (N64, SNES PAL/US).
export function resolveFormat(base, front, spine) {
  const fmt = { ...base, insert: false, spineEdge: 'side' }
  if (front) {
    const a = front.width / front.height
    if (base.kind === 'jewel') {
      if (a >= 0.8 && a <= 1.3) fmt.insert = a < 1.08
      else fmt.h = clamp(base.w / a, 90, 240)
    } else {
      const baseRatio = base.w / base.h
      const [min, max] = base.kind === 'carton' ? [0.45, 2.2] : [baseRatio * 0.75, baseRatio * 1.3]
      const ratio = clamp(a, min, max)
      const area = base.w * base.h
      fmt.w = Math.sqrt(area * ratio)
      fmt.h = Math.sqrt(area / ratio)
    }
  }
  if (spine) {
    const ratio = Math.max(spine.width, spine.height) / Math.min(spine.width, spine.height)
    const landscape = fmt.w > fmt.h * 1.15
    const fit = (edge) => Math.abs(Math.log(ratio / (edge / fmt.d)))
    if (base.kind === 'carton' && landscape && fit(fmt.w) < fit(fmt.h)) fmt.spineEdge = 'top'
    const edge = fmt.spineEdge === 'top' ? fmt.w : fmt.h
    // Un boîtier CD garde au moins son épaisseur réelle : son scan de tranche n'est
    // souvent que la bande imprimée, plus fine (dessinée alors à ses proportions).
    fmt.d = clamp(edge / ratio, base.kind === 'jewel' ? base.d : base.d * 0.7, base.d * 1.6)
  }
  return fmt
}

// Copie d'un canvas tournée d'un quart de tour (sens antihoraire si ccw).
function rotateCanvas(source, ccw = true) {
  const canvas = makeCanvas(source.height, source.width)
  const ctx = canvas.getContext('2d')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(ccw ? -Math.PI / 2 : Math.PI / 2)
  ctx.drawImage(source, -source.width / 2, -source.height / 2)
  return canvas
}

// --- Images ----------------------------------------------------------------------------

// Jaquettes réduites à la largeur demandée dès le décodage (createImageBitmap) : une
// étagère de plusieurs centaines de jeux ne garde pas les scans en pleine résolution.
// axis = 'height' pour une image étroite (tranche) : réduite selon sa hauteur.
async function loadBitmap(url, size, axis = 'width') {
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    const resize = axis === 'height' ? { resizeHeight: size } : { resizeWidth: size }
    return await createImageBitmap(blob, { ...resize, resizeQuality: 'high' })
  } catch {
    return null
  }
}

// Icônes de console (16 × 16, reprises de RomStation, les mêmes que dans le menu) :
// posées dans le bandeau de plateforme des tranches générées.
const SYSTEM_ICONS = import.meta.glob('./assets/systems/*.png', { eager: true, import: 'default' })
const iconCache = new Map()

function loadSystemIcon(platform) {
  const url = SYSTEM_ICONS[`./assets/systems/${platform}.png`]
  if (!url) return Promise.resolve(null)
  if (!iconCache.has(platform)) {
    iconCache.set(
      platform,
      // Chargée par une <img> et non fetch() : Vite intègre ces petites icônes en
      // URL data:, que la CSP (connect-src) refuse à fetch mais autorise aux images.
      new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = url
      })
    )
  }
  return iconCache.get(platform)
}

let fontsReady = null
function ensureFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all([
      document.fonts.load('600 32px "Inter Variable"'),
      document.fonts.load('400 32px "Inter Variable"')
    ]).catch(() => null)
  }
  return fontsReady
}

const FONT = '"Inter Variable", Inter, system-ui, sans-serif'

function hashHue(text) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360
  return h
}

// Couleurs manipulées en TSL (espace sRGB du canvas) : { h: 0-360, s: 0-1, l: 0-1 }.
function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h * 60, s, l }
}

function shade(color, dl) {
  return { ...color, l: Math.min(1, Math.max(0, color.l + dl)) }
}

function css(color) {
  return `hsl(${color.h.toFixed(1)}, ${(color.s * 100).toFixed(1)}%, ${(color.l * 100).toFixed(1)}%)`
}

function isLight(color) {
  return color.l > 0.6
}

// Couleur moyenne de la jaquette (sert à la tranche et au dos générés), ramenée dans
// une plage de luminosité exploitable ; à défaut de jaquette, teinte dérivée du titre.
function dominantColor(bitmap, title) {
  if (!bitmap) return { h: hashHue(title), s: 0.18, l: 0.22 }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 12
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, 12, 12)
  const data = ctx.getImageData(0, 0, 12, 12).data
  let r = 0
  let g = 0
  let b = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
  }
  const hsl = rgbToHsl(r / n / 255, g / n / 255, b / n / 255)
  return { h: hsl.h, s: Math.min(hsl.s * 1.15, 0.75), l: Math.min(Math.max(hsl.l, 0.14), 0.62) }
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(width))
  canvas.height = Math.max(2, Math.round(height))
  return canvas
}

// Dessine l'image en remplissant entièrement le rectangle (recadrage centré, comme
// object-fit: cover).
function drawCover(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.width, h / image.height)
  const sw = w / scale
  const sh = h / scale
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h)
}

// Texte sur une ligne, réduit jusqu'à tenir dans maxWidth.
function fitText(ctx, text, maxWidth, size, weight = 600, minSize = 6) {
  let s = size
  ctx.font = `${weight} ${s}px ${FONT}`
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s -= 1
    ctx.font = `${weight} ${s}px ${FONT}`
  }
  return s
}

// Retour à la ligne simple, au plus maxLines lignes (la dernière tronquée par "…").
function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width <= maxWidth || !line) line = test
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    lines.length = maxLines
    let last = lines[maxLines - 1]
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1)
    lines[maxLines - 1] = `${last}…`
  }
  return lines
}

// --- Faces ----------------------------------------------------------------------------

// Pochette avant : la jaquette, sous le plastique du boîtier (liseré de couleur pour
// un boîtier DVD, charnière sombre à gauche pour un boîtier CD). Sans jaquette, une
// pochette générée avec le titre.
function frontTexture(info, image, px) {
  const { fmt, title, platformLabel, base } = info
  const canvas = makeCanvas(px, (px * fmt.h) / fmt.w)
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  const inset = fmt.kind === 'keep' ? Math.round(W * 0.025) : 0
  if (fmt.kind === 'keep') {
    ctx.fillStyle = fmt.rim
    ctx.fillRect(0, 0, W, H)
  }
  let x = inset
  let y = inset
  let w = W - inset * 2
  let h = H - inset * 2
  if (fmt.insert) {
    // Boîtier CD : livret de 120 × 120 mm à droite, charnière sombre à gauche.
    ctx.fillStyle = '#141416'
    ctx.fillRect(0, 0, W, H)
    const mm = W / fmt.w
    w = 120 * mm
    h = Math.min(120 * mm, H - 2 * mm)
    x = W - w - 2.5 * mm
    y = (H - h) / 2
    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    for (let i = 0; i < 3; i++) ctx.fillRect(x * (0.25 + i * 0.22), 0, Math.max(1, mm * 0.6), H)
  }
  if (image) {
    drawCover(ctx, image, x, y, w, h)
  } else {
    const gradient = ctx.createLinearGradient(0, y, 0, y + h)
    gradient.addColorStop(0, css(shade(base, 0.08)))
    gradient.addColorStop(1, css(shade(base, -0.08)))
    ctx.fillStyle = gradient
    ctx.fillRect(x, y, w, h)
    const light = isLight(base)
    ctx.fillStyle = light ? 'rgba(15,15,18,0.88)' : 'rgba(255,255,255,0.92)'
    ctx.textBaseline = 'top'
    const size = Math.round(w * 0.1)
    ctx.font = `600 ${size}px ${FONT}`
    const lines = wrapText(ctx, title, w * 0.82, 4)
    lines.forEach((line, i) => ctx.fillText(line, x + w * 0.09, y + h * 0.1 + i * size * 1.15))
    if (platformLabel) {
      ctx.fillStyle = light ? 'rgba(15,15,18,0.55)' : 'rgba(255,255,255,0.55)'
      fitText(ctx, platformLabel, w * 0.82, Math.round(w * 0.05), 500)
      ctx.textBaseline = 'bottom'
      ctx.fillText(platformLabel, x + w * 0.09, y + h * 0.92)
    }
  }
  if (fmt.kind === 'jewel' && !fmt.insert) {
    const hinge = Math.round(W * 0.06)
    ctx.fillStyle = 'rgba(0,0,0,0.38)'
    ctx.fillRect(0, 0, hinge, H)
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fillRect(hinge, 0, Math.max(1, W * 0.004), H)
  }
  return canvas
}

// Code-barres décoratif (dos généré), stable pour un même titre.
function drawBarcode(ctx, x, y, w, h, seed) {
  ctx.fillStyle = '#F4F4F2'
  ctx.fillRect(x, y, w, h)
  let state = seed + 7
  let cx = x + w * 0.08
  ctx.fillStyle = '#111'
  while (cx < x + w * 0.92) {
    state = (state * 9301 + 49297) % 233280
    const bar = 1 + (state % 3)
    ctx.fillRect(cx, y + h * 0.12, bar * (w / 110), h * 0.62)
    cx += (bar + 1 + (state % 2)) * (w / 110)
  }
}

// Dos : le scan du dos s'il existe ; sinon un dos généré à partir de la face avant
// (fond flouté), avec titre, crédits, nombre de disques et bandeau de plateforme.
function backTexture(info, backImage, frontImage, px) {
  const { fmt, title, platformLabel, base, game } = info
  const canvas = makeCanvas(px, (px * fmt.h) / fmt.w)
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  const inset = fmt.kind === 'keep' ? Math.round(W * 0.025) : 0
  if (fmt.kind === 'keep') {
    ctx.fillStyle = fmt.rim
    ctx.fillRect(0, 0, W, H)
  }
  const x = inset
  const y = inset
  const w = W - inset * 2
  const h = H - inset * 2
  if (backImage) {
    drawCover(ctx, backImage, x, y, w, h)
    return canvas
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = css(shade(base, -0.06))
  ctx.fillRect(x, y, w, h)
  if (frontImage) {
    ctx.filter = `blur(${Math.round(W * 0.04)}px) brightness(0.42) saturate(1.1)`
    drawCover(ctx, frontImage, x - w * 0.1, y - h * 0.1, w * 1.2, h * 1.2)
    ctx.filter = 'none'
  }
  ctx.restore()

  const pad = w * 0.08
  const textColor = 'rgba(255,255,255,0.94)'
  const mutedColor = 'rgba(255,255,255,0.62)'
  ctx.textBaseline = 'top'

  // Bandeau de plateforme en bas (à la manière des dos PlayStation / Nintendo).
  const band = h * 0.075
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(x, y + h - band, w, band)
  if (platformLabel) {
    ctx.fillStyle = mutedColor
    fitText(ctx, platformLabel.toUpperCase(), w * 0.5, Math.round(band * 0.38), 600)
    ctx.textBaseline = 'middle'
    ctx.fillText(platformLabel.toUpperCase(), x + pad, y + h - band / 2)
    ctx.textBaseline = 'top'
  }

  // Titre et crédits.
  let cy = y + h * 0.08
  const titleSize = Math.round(w * 0.072)
  ctx.font = `600 ${titleSize}px ${FONT}`
  ctx.fillStyle = textColor
  for (const line of wrapText(ctx, title, w - pad * 2, 3)) {
    ctx.fillText(line, x + pad, cy)
    cy += titleSize * 1.18
  }
  cy += titleSize * 0.35
  const credits = [game.year, game.developer, game.publisher].filter(Boolean).join(' · ')
  if (credits) {
    ctx.fillStyle = mutedColor
    ctx.font = `400 ${Math.round(w * 0.038)}px ${FONT}`
    for (const line of wrapText(ctx, credits, w - pad * 2, 2)) {
      ctx.fillText(line, x + pad, cy)
      cy += w * 0.052
    }
  }

  // Aperçu de la jaquette (à la place des captures d'écran d'un vrai dos).
  if (frontImage) {
    const tw = w * 0.36
    const th = (tw * fmt.h) / fmt.w
    const ty = Math.min(cy + h * 0.05, y + h - band - th - h * 0.2)
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = w * 0.03
    drawCover(ctx, frontImage, x + pad, ty, tw, th)
    ctx.restore()
  }

  // Pictogrammes : disques.
  if (game.discCount > 1) {
    ctx.fillStyle = mutedColor
    ctx.font = `500 ${Math.round(w * 0.04)}px ${FONT}`
    ctx.textBaseline = 'bottom'
    ctx.fillText(`${game.discCount} disques`, x + pad, y + h - band - h * 0.04)
  }

  drawBarcode(
    ctx,
    x + w - pad - w * 0.26,
    y + h - band - h * 0.04 - w * 0.13,
    w * 0.26,
    w * 0.13,
    hashHue(title)
  )
  return canvas
}

// Tranche (côté charnière, visible à gauche quand on regarde la face avant) : le scan
// de la tranche s'il existe (images/spine.*), sinon couleur de la jaquette, bandeau de
// plateforme en haut et titre à la verticale.
function spineTexture(info, px, image, edgeMm = info.fmt.h) {
  const { fmt } = info
  // Dessinée à l'horizontale (texte de gauche à droite) puis tournée : la texture est
  // haute de la longueur du bord (edgeMm) et large de fmt.d.
  const scale = px / fmt.w
  const length = Math.round(edgeMm * scale)
  const thick = Math.max(8, Math.round(fmt.d * scale))
  const canvas = makeCanvas(thick, length)
  const ctx = canvas.getContext('2d')

  if (fmt.kind === 'keep') {
    ctx.fillStyle = fmt.rim
    ctx.fillRect(0, 0, thick, length)
  }
  if (fmt.kind === 'jewel') {
    ctx.fillStyle = '#121214'
    ctx.fillRect(0, 0, thick, length)
  }
  const inset = fmt.kind === 'keep' ? Math.max(1, Math.round(thick * 0.1)) : 0
  const sleeveTop = fmt.kind === 'keep' ? Math.round(length * 0.015) : 0
  if (image) {
    const w = thick - inset * 2
    const h = length - sleeveTop * 2
    const horizontal = image.width > image.height
    const imgAcross = horizontal ? image.height : image.width
    const imgAlong = horizontal ? image.width : image.height
    // Largeur dessinée : étirée sur toute l'épaisseur (un scan aux proportions un peu
    // différentes garderait sinon seulement le milieu du titre), sauf la bande
    // imprimée nettement plus fine d'un boîtier CD épais, centrée dans le plastique.
    let drawW = w
    if (fmt.kind === 'jewel') drawW = Math.min(w, (imgAcross / imgAlong) * h * 1.15)
    const left = inset + (w - drawW) / 2
    if (horizontal) {
      // Scan à l'horizontale : tourné d'un quart de tour (lecture de haut en bas).
      ctx.save()
      ctx.translate(left + drawW / 2, sleeveTop + h / 2)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(image, -h / 2, -drawW / 2, h, drawW)
      ctx.restore()
    } else {
      ctx.drawImage(image, left, sleeveTop, drawW, h)
    }
    return canvas
  }
  return drawGeneratedSpine(ctx, info, { thick, length, inset, sleeveTop })
}

// Gabarits de tranche par console, pour les jeux sans scan de tranche, comparés aux
// vraies tranches LaunchBox (éditions PAL en priorité) : couleur du fond, bandeau de
// plateforme. La mention de plateforme est écrite en toutes lettres, sans reproduire de
// logo, et le titre en police standard : une approximation des conventions de chaque
// console, pas une copie de la tranche officielle du jeu.
// body : couleur du fond, 'cover' (couleur dominante de la jaquette) ou 'art' (bande
// de l'illustration de la jaquette, comme les tranches PS3, DS ou des boîtes carton) ;
// art : vignette de la jaquette en pied (tranches épaisses) ;
// bands : bandeaux de plateforme, en haut (ou en bas si bottom). Chacun ne reprend que
// ce que porte la vraie tranche : le nom écrit (label), l'icône de console (icon, clé
// d'une icône RomStation, seulement quand elle correspond au logo imprimé : pas de
// dessin de console pour la DS, la Wii ou les Game Boy), ou les deux.
const SPINE_STYLES = {
  ps1: {
    body: '#0E0E10',
    bands: [{ bg: '#0E0E10', fg: '#FFFFFF', icon: 'ps1', label: 'PlayStation', rule: true }]
  },
  ps2: {
    body: '#F4F4F2',
    bands: [{ bg: '#0E0E10', fg: '#FFFFFF', icon: 'ps1', label: 'PlayStation 2' }]
  },
  ps3: { body: 'art', bands: [{ bg: '#C4161C', icon: 'ps3' }] },
  psp: { body: '#0E0E10', bands: [{ bg: '#0E0E10', icon: 'psp', rule: true }] },
  gamecube: {
    body: '#0E0E10',
    bands: [
      { bg: '#0E0E10', fg: '#FFFFFF', icon: 'gamecube', label: 'NINTENDO GAMECUBE', rule: true }
    ]
  },
  wii: { body: '#F7F7F7', bands: [{ bg: '#F7F7F7', fg: '#8A8D93', label: 'Wii' }] },
  wiiu: { body: '#1E8BD0', bands: [{ bg: '#F7F7F7', fg: '#1E8BD0', label: 'Wii U' }] },
  switch: { body: '#E60012', bands: [{ bg: '#E60012', icon: 'switch', rule: true }] },
  nds: { body: 'art', bands: [{ bg: '#F7F7F7', fg: '#55585E', label: 'NINTENDO DS' }] },
  '3ds': {
    body: '#F7F7F7',
    bands: [{ bg: '#F7F7F7', fg: '#55585E', label: 'NINTENDO', icon: '3ds', iconAfter: true }],
    art: true
  },
  xbox360: { body: 'art', bands: [{ bg: '#F2F2F2', fg: '#5DAA23', label: 'XBOX 360' }] },
  dreamcast: {
    body: '#2C5DAA',
    bands: [{ bg: '#2C5DAA', fg: '#FFFFFF', icon: 'dreamcast', label: 'Dreamcast', rule: true }]
  },
  saturn: {
    body: '#101012',
    bands: [
      { bg: '#101012', fg: '#D7D9DE', label: 'SEGA', rule: true },
      { bg: '#101012', fg: '#D7D9DE', icon: 'saturn', label: 'SEGA SATURN', bottom: true }
    ]
  },
  n64: {
    body: 'art',
    bands: [{ bg: '#D4202A', fg: '#FFFFFF', icon: 'n64', label: 'NINTENDO 64', bottom: true }]
  },
  snes: {
    body: 'art',
    bands: [{ bg: '#2A2A2F', fg: '#FFFFFF', icon: 'snes', label: 'SUPER NINTENDO' }]
  },
  gba: { body: 'art', bands: [{ bg: '#4C3FA8', fg: '#FFFFFF', label: 'GAME BOY ADVANCE' }] },
  gb: { body: 'art', bands: [{ bg: '#5A5F66', fg: '#FFFFFF', label: 'GAME BOY' }] },
  gbc: { body: 'art', bands: [{ bg: '#7B3FA0', fg: '#FFFFFF', label: 'GAME BOY COLOR' }] }
}

// Icônes utilisées par les bandeaux d'une console, chargées avant de dessiner.
async function loadSpineIcons(platform) {
  const keys = (SPINE_STYLES[platform]?.bands || []).map((b) => b.icon).filter(Boolean)
  const entries = await Promise.all(keys.map(async (k) => [k, await loadSystemIcon(k)]))
  return Object.fromEntries(entries.filter(([, img]) => img))
}

function relativeLuminance(colorCss) {
  const ctx = document.createElement('canvas').getContext('2d')
  ctx.fillStyle = colorCss
  const hex = ctx.fillStyle // normalisé en #rrggbb
  const n = parseInt(hex.slice(1), 16)
  const ch = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255)
}

function drawGeneratedSpine(ctx, info, { thick, length, inset, sleeveTop }) {
  const { fmt, platformLabel, base, game, front } = info
  // Mentions de dump ajoutées aux titres du catalogue ("(Undub)", "(NTSC)",
  // "[480p]") : absentes des vraies boîtes, donc pas sur la tranche.
  const title = String(info.title)
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .trim()
  const style = SPINE_STYLES[game.platform] || {
    body: 'cover',
    bands: platformLabel
      ? [{ bg: '#0E0E10', fg: '#FFFFFF', label: platformLabel.toUpperCase() }]
      : []
  }
  // Fond illustré : sans jaquette, retombe sur sa couleur dominante.
  const artBody = style.body === 'art' && front
  const bodyColor =
    style.body === 'cover' || style.body === 'art' ? css(shade(base, -0.04)) : style.body
  const textColor = artBody || relativeLuminance(bodyColor) <= 0.35 ? '#FFFFFF' : '#141416'

  // Repère tourné : x le long de la tranche (de haut en bas), y à travers.
  const along = length - sleeveTop * 2
  const across = thick - inset * 2
  ctx.fillStyle = bodyColor
  ctx.fillRect(inset, sleeveTop, across, along)
  if (artBody) {
    // Bande verticale prise sur toute la hauteur de la jaquette, au tiers gauche
    // (souvent le décor plutôt que le logo), assombrie pour que le titre reste lisible.
    const stripW = Math.max(1, (front.height * across) / along)
    const sx = Math.min(front.width - stripW, front.width * 0.18)
    ctx.drawImage(front, Math.max(0, sx), 0, stripW, front.height, inset, sleeveTop, across, along)
    ctx.fillStyle = 'rgba(0,0,0,0.38)'
    ctx.fillRect(inset, sleeveTop, across, along)
  }
  ctx.save()
  ctx.translate(thick / 2, length / 2)
  ctx.rotate(Math.PI / 2)
  const x0 = -along / 2
  const y0 = -across / 2

  // Tailles de texte bornées à la fois par l'épaisseur et par la longueur : une
  // tranche fine (boîtier DVD) écrit en grand sur toute sa largeur, une tranche épaisse
  // (boîte carton) garde un texte proportionné à sa longueur.
  const bandSize = Math.max(4, Math.round(Math.min(across * 0.36, along * 0.045)))

  // Bandeaux de plateforme, en haut de la tranche (en bas si bottom, comme la N64).
  let cursor = x0
  let end = x0 + along
  for (const band of style.bands || []) {
    const { bg, fg, label, rule, bottom, iconAfter } = band
    const icon = band.icon ? info.icons?.[band.icon] : null
    // Icône de la console : agrandie sans lissage (pixel art 16 px).
    const iconSize = icon ? Math.round(Math.min(across * 0.66, bandSize * 2.4)) : 0
    const gap = label && icon ? bandSize * 0.6 : 0
    ctx.font = `600 ${bandSize}px ${FONT}`
    const textWidth = label ? ctx.measureText(label).width : 0
    if (!icon && !label) continue
    const bandLength = Math.min(along * 0.3, textWidth + iconSize + gap + bandSize * 2.4)
    const bandStart = bottom ? end - bandLength : cursor
    ctx.fillStyle = bg
    ctx.fillRect(bandStart, y0, bandLength, across)
    const content = Math.min(bandLength - bandSize * 1.2, textWidth + iconSize + gap)
    let x = bandStart + (bandLength - content) / 2
    const drawIcon = () => {
      const ih = Math.round((iconSize * icon.height) / icon.width)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(icon, x, -ih / 2, iconSize, ih)
      ctx.imageSmoothingEnabled = true
      x += iconSize + gap
    }
    const drawLabel = () => {
      const room = content - iconSize - gap
      ctx.fillStyle = fg
      fitText(ctx, label, room, bandSize, 600, 4)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, x + room / 2, 0)
      x += room + gap
    }
    if (icon && !iconAfter) drawIcon()
    if (label) drawLabel()
    if (icon && iconAfter) drawIcon()
    if (bottom) end -= bandLength
    else cursor += bandLength
    if (rule && !bottom) {
      ctx.fillStyle = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.35)'
      const ruleW = Math.max(1, bandSize * 0.12)
      ctx.fillRect(cursor, y0 + across * 0.18, ruleW, across * 0.64)
      cursor += ruleW
    }
  }

  // Pied : éditeur, puis vignette de la jaquette (tranches assez épaisses).
  const credit = game.publisher || game.developer
  const creditSize = Math.max(4, Math.round(Math.min(across * 0.26, along * 0.035)))
  if (credit && creditSize >= 4) {
    ctx.font = `500 ${creditSize}px ${FONT}`
    const creditLength = Math.min(along * 0.22, ctx.measureText(credit).width + creditSize * 1.6)
    ctx.fillStyle = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.6)' : 'rgba(20,20,22,0.6)'
    fitText(ctx, credit, creditLength - creditSize * 0.8, creditSize, 500, 4)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(credit, end - creditSize * 0.8, 0)
    end -= creditLength
  }
  if (style.art && front && fmt.d >= 12) {
    const side = Math.min(across * 0.84, along * 0.26)
    const ax = end - side - Math.min(across, along * 0.1) * 0.25
    ctx.save()
    ctx.translate(ax + side / 2, 0)
    ctx.rotate(-Math.PI / 2)
    drawCover(ctx, front, -side / 2, -side / 2, side, side)
    ctx.restore()
    end = ax
  }

  // Titre : le plus grand possible dans l'espace restant, sur plusieurs lignes si la
  // tranche est assez épaisse, centré.
  const margin = Math.min(across, along * 0.1) * 0.4
  const room = end - cursor - margin * 2
  if (room > bandSize * 2) {
    ctx.fillStyle = textColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (artBody) {
      ctx.shadowColor = 'rgba(0,0,0,0.7)'
      ctx.shadowBlur = Math.max(2, across * 0.08)
    }
    let size = Math.round(Math.min(across * 0.52, along * 0.09))
    let lines = [title]
    for (; size > 4; size--) {
      ctx.font = `700 ${size}px ${FONT}`
      const maxLines = Math.max(1, Math.floor((across * 0.86) / (size * 1.12)))
      const wrapped = wrapText(ctx, title, room, maxLines)
      const truncated = wrapped[wrapped.length - 1].endsWith('…')
      if (!truncated && wrapped.every((line) => ctx.measureText(line).width <= room)) {
        lines = wrapped
        break
      }
    }
    ctx.font = `700 ${size}px ${FONT}`
    const lineHeight = size * 1.12
    const mid = (cursor + end) / 2
    lines.forEach((line, i) => {
      ctx.fillText(line, mid, (i - (lines.length - 1) / 2) * lineHeight + across * 0.02)
    })
    ctx.shadowColor = 'transparent'
  }
  ctx.restore()
  return ctx.canvas
}

// Dessus, dessous et côté ouverture : matière du boîtier (plastique coloré, boîtier
// CD transparent sombre, carton dans la couleur de la jaquette).
function edgeTexture(info, lengthMm, px, opening) {
  const { fmt, base } = info
  const scale = px / fmt.w
  const canvas = makeCanvas(Math.max(8, fmt.d * scale), lengthMm * scale)
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  if (fmt.kind === 'keep') {
    ctx.fillStyle = fmt.rim
    ctx.fillRect(0, 0, W, H)
    // Rainures du boîtier côté ouverture.
    if (opening) {
      ctx.fillStyle = fmt.light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)'
      ctx.fillRect(W * 0.46, 0, Math.max(1, W * 0.08), H)
    }
  } else if (fmt.kind === 'jewel') {
    ctx.fillStyle = '#1A1A1D'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(0, 0, W, Math.max(1, H * 0.006))
    ctx.fillRect(W * 0.5, 0, Math.max(1, W * 0.06), H)
  } else {
    ctx.fillStyle = css(shade(base, -0.04))
    ctx.fillRect(0, 0, W, H)
  }
  return canvas
}

function toTexture(canvas, renderer) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1
  return texture
}

// --- Modèle -----------------------------------------------------------------------------

// Construit la boîte d'un jeu. quality : 'thumb' (étagère) ou 'full' (fiche du jeu).
// Renvoie { group, fmt, dispose }. Unités de la scène : le millimètre.
export async function buildBoxModel(
  game,
  { platformLabel = '', quality = 'thumb', renderer } = {}
) {
  const baseFmt = formatFor(game)
  const px = quality === 'full' ? 1024 : 360
  const [front, back, spineImage] = await Promise.all([
    loadBitmap(game.coverUrl, px),
    loadBitmap(game.backCoverUrl, px),
    loadBitmap(game.spineCoverUrl, Math.round((px * 240) / baseFmt.w), 'height'),
    ensureFonts()
  ])
  const icons = spineImage ? {} : await loadSpineIcons(game.platform)
  const fmt = resolveFormat(baseFmt, front, spineImage)
  const info = {
    fmt,
    game,
    front,
    icons,
    title: game.title,
    platformLabel,
    base: dominantColor(front, game.title)
  }

  const glossy = fmt.kind !== 'carton'
  const material = (canvas, roughness = glossy ? 0.32 : 0.78) =>
    new THREE.MeshStandardMaterial({ map: toTexture(canvas, renderer), roughness, metalness: 0 })

  // Ordre des matériaux d'une BoxGeometry : +x, -x, +y, -y, +z, -z. Les faces ±y
  // s'étendent en x sur la largeur de la boîte (haut du canvas vers l'arrière) : leurs
  // canvas, dessinés à la verticale, sont tournés d'un quart de tour.
  const onTop = fmt.spineEdge === 'top'
  const plainTop = rotateCanvas(edgeTexture(info, fmt.w, px, false))
  const materials = [
    material(edgeTexture(info, fmt.h, px, true), 0.45),
    // Tranche sur le dessus (boîte carton à l'italienne) : le côté reste illustré,
    // avec une tranche générée (titre et plateforme).
    material(spineTexture(info, px, onTop ? null : spineImage)),
    onTop
      ? material(rotateCanvas(spineTexture(info, px, spineImage, fmt.w)))
      : material(plainTop, 0.45),
    material(plainTop, 0.45),
    material(frontTexture(info, front, px)),
    material(backTexture(info, back, front, px))
  ]

  const geometry = new THREE.BoxGeometry(fmt.w, fmt.h, fmt.d)
  const mesh = new THREE.Mesh(geometry, materials)
  const group = new THREE.Group()
  group.add(mesh)

  front?.close?.()
  back?.close?.()
  spineImage?.close?.()

  return {
    group,
    fmt,
    dispose() {
      geometry.dispose()
      for (const m of materials) {
        m.map?.dispose()
        m.dispose()
      }
    }
  }
}

// --- Éclairage commun -------------------------------------------------------------

function setupScene(renderer) {
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.55
  pmrem.dispose()
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(-220, 320, 480)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xbfd2ff, 0.5)
  rim.position.set(400, 120, -300)
  scene.add(rim)
  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  return scene
}

function configureRenderer(renderer) {
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.05
}

const FOV = 18

// Place la caméra pour qu'un millimètre de la boîte vaille pxPerMm pixels au centre
// de la boîte (toutes les boîtes de l'étagère gardent ainsi la même échelle), la
// boîte étant décalée de offsetY pixels vers le haut.
function frameCamera(camera, width, height, pxPerMm, offsetY = 0) {
  const visibleHeight = height / pxPerMm
  const distance = visibleHeight / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2))
  camera.fov = FOV
  camera.aspect = width / height
  camera.near = distance / 10
  camera.far = distance * 10
  camera.position.set(0, offsetY / pxPerMm, distance)
  camera.lookAt(0, offsetY / pxPerMm, 0)
  camera.updateProjectionMatrix()
}

// --- Rendu partagé (étagère) --------------------------------------------------------

let shared = null

function getShared() {
  if (shared) return shared
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  })
  configureRenderer(renderer)
  renderer.setPixelRatio(1)
  shared = { renderer, scene: setupScene(renderer), camera: new THREE.PerspectiveCamera() }
  return shared
}

export function getSharedRenderer() {
  return getShared().renderer
}

// Rend un modèle dans le canvas 2D d'une tuile, avec l'orientation donnée (degrés).
// bottom : marge (px du canvas) entre le bas de la boîte et le bas du canvas, pour
// aligner les boîtes de hauteurs différentes sur une même ligne.
export function renderSnapshot(model, target, { rx = 6, ry = 16, pxPerMm, bottom = 0 }) {
  const { renderer, scene, camera } = getShared()
  const width = target.width
  const height = target.height
  renderer.setSize(width, height, false)
  const offsetY = height / 2 - bottom - (model.fmt.h * pxPerMm) / 2
  frameCamera(camera, width, height, pxPerMm, offsetY)
  model.group.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), 0)
  scene.add(model.group)
  renderer.render(scene, camera)
  scene.remove(model.group)
  const ctx = target.getContext('2d')
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(renderer.domElement, 0, 0, width, height)
}

// Modèles récemment utilisés (survol de l'étagère) : gardés pour réanimer une boîte
// sans tout reconstruire, dans la limite de MODEL_CACHE_SIZE.
const MODEL_CACHE_SIZE = 24
const modelCache = new Map()

function cacheKey(game, platformLabel) {
  return [
    game.id,
    game.coverUrl,
    game.backCoverUrl,
    game.spineCoverUrl,
    game.title,
    game.discCount,
    platformLabel
  ].join('|')
}

export function getThumbModel(game, platformLabel) {
  const key = cacheKey(game, platformLabel)
  if (modelCache.has(key)) {
    const entry = modelCache.get(key)
    modelCache.delete(key)
    modelCache.set(key, entry)
    return entry
  }
  const entry = buildBoxModel(game, {
    platformLabel,
    quality: 'thumb',
    renderer: getShared().renderer
  })
  modelCache.set(key, entry)
  while (modelCache.size > MODEL_CACHE_SIZE) {
    const [oldKey, oldEntry] = modelCache.entries().next().value
    modelCache.delete(oldKey)
    oldEntry.then((model) => model.dispose()).catch(() => {})
  }
  return entry
}

// File d'attente des premiers rendus : une tuile à la fois, en laissant le navigateur
// respirer entre deux, pour ne pas figer le défilement d'une grande étagère.
const queue = []
let draining = false

export function queueSnapshot(task) {
  return new Promise((resolve) => {
    queue.push({ task, resolve })
    drain()
  })
}

async function drain() {
  if (draining) return
  draining = true
  while (queue.length) {
    const { task, resolve } = queue.shift()
    try {
      await task()
    } catch {
      // Une boîte qui échoue garde son aperçu de secours.
    }
    resolve()
    await new Promise((r) => requestAnimationFrame(() => r()))
  }
  draining = false
}

// --- Visionneuse (fiche du jeu) ------------------------------------------------------

export function createViewerRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  configureRenderer(renderer)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  const scene = setupScene(renderer)
  const camera = new THREE.PerspectiveCamera()
  return {
    renderer,
    render(model, { rx, ry, width, height }) {
      renderer.setSize(width, height, false)
      // La boîte (sa diagonale) occupe toute de la plus petite dimension, quelle que soit sa forme.
      const radius = Math.hypot(model.fmt.w, model.fmt.h, model.fmt.d) / 2
      const pxPerMm = (Math.min(width, height) * 1.0) / (radius * 2)
      frameCamera(camera, width, height, pxPerMm)
      model.group.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), 0)
      if (model.group.parent !== scene) scene.add(model.group)
      renderer.render(scene, camera)
    },
    detach(model) {
      scene.remove(model.group)
    },
    dispose() {
      scene.environment?.dispose()
      renderer.dispose()
    }
  }
}
