// Table de correspondance plateforme -> émulateurs RomStation possibles (dans l'ordre
// de préférence). Certaines plateformes ont plusieurs émulateurs installés en
// parallèle (Switch, PS3) : le premier trouvé sur le disque est utilisé par défaut.
export const PLATFORM_EMULATORS = {
  ps1: ['DuckStation'],
  ps2: ['PCSX2'],
  ps3: ['RPCS3', 'RPC3'],
  gamecube: ['Dolphin'],
  wii: ['Dolphin'],
  // "CEMU" (tout en majuscules) et pas "Cemu" : c'est le nom exact du dossier créé par
  // RomStation dans app/emulators/downloads (scanner-emulators.js indexe par nom de
  // dossier tel quel, sensible à la casse) — une entrée mal casée ne matcherait jamais.
  wiiu: ['CEMU'],
  switch: ['Ryujinx', 'Eden'],
  n64: ['Project64'],
  snes: ['Snes9x'],
  gba: ['mGBA'],
  gb: ['mGBA'],
  gbc: ['mGBA'],
  nds: ['melonDS'],
  '3ds': ['Azahar', 'Citra'],
  dreamcast: ['Flycast'],
  psp: ['PPSSPP'],
  // Xbox 360 : RomStation lui-même ne distribue pas de jeux pour cette console (aucune
  // extension/plateforme de jeu associée ci-dessous), seul l'émulateur est géré ici —
  // pour pouvoir le détecter et l'ouvrir depuis la page Émulateurs.
  xbox360: ['Xenia']
}

// Extensions de rom non ambiguës -> plateforme.
export const EXTENSION_TO_PLATFORM = {
  '.cue': 'ps1',
  '.pbp': 'ps1',
  '.gdi': 'dreamcast',
  '.cdi': 'dreamcast',
  '.chd': 'ps1', // aussi utilisé par PS2/Dreamcast selon le jeu : à revoir si ça pose problème en pratique
  '.z64': 'n64',
  '.n64': 'n64',
  '.v64': 'n64',
  '.sfc': 'snes',
  '.smc': 'snes',
  '.gba': 'gba',
  '.gb': 'gb',
  '.gbc': 'gbc',
  '.nds': 'nds',
  '.3ds': '3ds',
  '.cci': '3ds',
  '.cxi': '3ds',
  '.nsp': 'switch',
  '.xci': 'switch',
  '.rvz': 'gamecube',
  '.wbfs': 'wii',
  '.wud': 'wiiu',
  '.wux': 'wiiu',
  '.wua': 'wiiu',
  '.pkg': 'ps3'
}

// Extensions ambiguës : la plateforme réelle dépend du jeu (.iso est utilisé par PS2,
// GameCube, Wii, PSP...). Ces jeux ressortent du scan avec platform: null ; l'interface
// doit permettre de choisir la plateforme une fois, ce qui est ensuite mémorisé
// (voir config.js: getOverrides/setOverride) pour ne plus jamais redemander.
export const AMBIGUOUS_EXTENSIONS = new Set(['.iso'])

export function guessPlatformFromFile(fileName) {
  const dot = fileName.lastIndexOf('.')
  if (dot === -1) return null
  const ext = fileName.slice(dot).toLowerCase()
  if (AMBIGUOUS_EXTENSIONS.has(ext)) return null
  return EXTENSION_TO_PLATFORM[ext] || null
}

// Libellés lisibles pour l'interface (filtre, sélecteur de plateforme des jeux
// ambigus). L'ordre ici définit l'ordre d'affichage dans les listes déroulantes.
export const PLATFORM_LABELS = {
  ps1: 'PlayStation',
  ps2: 'PlayStation 2',
  ps3: 'PlayStation 3',
  gamecube: 'GameCube',
  wii: 'Wii',
  wiiu: 'Wii U',
  switch: 'Switch',
  n64: 'Nintendo 64',
  snes: 'Super Nintendo',
  gba: 'Game Boy Advance',
  gb: 'Game Boy',
  gbc: 'Game Boy Color',
  nds: 'Nintendo DS',
  '3ds': 'Nintendo 3DS',
  dreamcast: 'Dreamcast',
  psp: 'PSP',
  saturn: 'Saturn',
  xbox360: 'Xbox 360'
}

export const ASSIGNABLE_PLATFORMS = Object.keys(PLATFORM_EMULATORS)
