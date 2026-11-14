// Icônes génériques par plateforme : de simples pictogrammes maison (manette,
// cartouche, disque, portable) — pas les vrais logos des fabricants — plus une
// couleur d'accent par famille de console (voir platform-families.js), pour
// repérer un coup d'œil dans la sidebar et sur la page Émulateurs.
import { FAMILY_ORDER } from './platform-families'

// Forme du pictogramme selon le type d'appareil, indépendamment du fabricant :
// 'handheld' (portable), 'disc' (console à disque/DVD), 'cartridge' (console à
// cartouche), 'hybrid' (portable + dock, ex. Switch).
const PLATFORM_ICON_TYPE = {
  n64: 'cartridge',
  snes: 'cartridge',
  gamecube: 'disc',
  wii: 'disc',
  wiiu: 'disc',
  switch: 'hybrid',
  gb: 'handheld',
  gbc: 'handheld',
  gba: 'handheld',
  nds: 'handheld',
  '3ds': 'handheld',
  ps1: 'disc',
  ps2: 'disc',
  ps3: 'disc',
  psp: 'handheld',
  dreamcast: 'disc',
  xbox360: 'disc'
}

const FAMILY_COLORS = {
  Nintendo: '#e2545f',
  PlayStation: '#5b8dee',
  Sega: '#3ecfcf',
  Xbox: '#5ec127'
}

const DEFAULT_COLOR = '#9aa0a6'

// Dérivé de FAMILY_ORDER plutôt que dupliqué : une plateforme non classée (voir le
// filet de sécurité "Autres" de EmulatorsPage.vue) retombe sur la couleur neutre.
const platformToColor = new Map()
for (const family of FAMILY_ORDER) {
  const color = FAMILY_COLORS[family.label] || DEFAULT_COLOR
  for (const platform of family.platforms) platformToColor.set(platform, color)
}

export function iconTypeFor(platform) {
  return PLATFORM_ICON_TYPE[platform] || 'handheld'
}

export function colorFor(platform) {
  return platformToColor.get(platform) || DEFAULT_COLOR
}
