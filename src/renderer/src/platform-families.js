// Rangement par famille de console, dans un ordre chronologique par génération à
// l'intérieur de chaque famille. Partagé entre la sidebar et la page Émulateurs pour
// qu'elles présentent les plateformes exactement dans le même ordre.
export const FAMILY_ORDER = [
  {
    label: 'Nintendo',
    platforms: ['n64', 'gamecube', 'wii', 'wiiu', 'switch', 'gb', 'gbc', 'gba', 'nds', '3ds']
  },
  { label: 'PlayStation', platforms: ['ps1', 'ps2', 'ps3', 'psp'] },
  { label: 'Sega', platforms: ['dreamcast'] },
  { label: 'Xbox', platforms: ['xbox360'] }
]

// Trie une liste d'objets ayant un champ "platform" selon FAMILY_ORDER. Toute
// plateforme absente de FAMILY_ORDER (ajoutée plus tard sans être classée) atterrit à
// la fin plutôt que de disparaître.
export function orderByFamily(items) {
  const order = new Map()
  let i = 0
  for (const family of FAMILY_ORDER) {
    for (const platform of family.platforms) order.set(platform, i++)
  }
  return [...items].sort((a, b) => {
    const oa = order.has(a.platform) ? order.get(a.platform) : Infinity
    const ob = order.has(b.platform) ? order.get(b.platform) : Infinity
    return oa - ob
  })
}
