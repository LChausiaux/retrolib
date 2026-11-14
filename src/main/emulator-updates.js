// Vérification de mise à jour PAR ÉMULATEUR CONNU. Chaque émulateur publie ses
// versions différemment (GitHub Releases, tags git bruts, son propre endpoint JSON de
// mise à jour...) — impossible à deviner automatiquement, donc cette table est tenue à
// jour à la main dans le code (voir échange avec l'utilisateur : pas de réglage dans
// l'interface, on ajoute une entrée ici quand un nouvel émulateur doit être suivi).
// Chaque entrée a été vérifiée manuellement contre la vraie API/le vrai endpoint avant
// d'être ajoutée — pas de nom de dépôt deviné à l'aveugle.
export const EMULATOR_UPDATE_SOURCES = {
  DuckStation: { type: 'github-release', repo: 'stenzek/duckstation' },
  PCSX2: { type: 'github-release', repo: 'PCSX2/pcsx2' },
  // RPCS3 publie des "releases" GitHub, mais leur propre changelog le dit noir sur
  // blanc : "our version increases are landmarks and not stable builds" — v0.0.42 ne
  // reflète PAS le vrai numéro de build utilisé en interne (celui qu'on voit dans le
  // nom de dossier RomStation, ex. "0.0.20-13239"). On utilise donc leur vrai endpoint
  // de mise à jour (celui de leur propre update_manager.cpp, vu dans le code source),
  // qui donne le numéro de build réel. Non testé en direct (update.rpcs3.net est
  // bloqué depuis mon bac à sable, comme dolphin-emu.org plus tôt) — déduit du code
  // source officiel, premier vrai test quand tu cliqueras sur le bouton.
  RPCS3: {
    type: 'custom-json',
    url: 'https://update.rpcs3.net/?api=v3&c=0000000&os_type=windows&os_arch=x86_64&os_version=10.0.19041',
    path: 'latest_build.version'
  },
  // Dolphin ne publie AUCUNE release GitHub (vérifié : /releases et les seuls tags
  // datent de l'ère SVN, il y a plus de 10 ans). Leur vrai mécanisme de mise à jour
  // est ce petit endpoint JSON, celui qu'utilisent Homebrew et Scoop pour détecter les
  // nouvelles versions — pas du scraping, c'est leur update-checker officiel.
  Dolphin: {
    type: 'custom-json',
    url: 'https://dolphin-emu.org/update/latest/beta',
    path: 'shortrev'
  },
  // Clé "CEMU" (majuscules) pour matcher le nom exact du dossier RomStation, voir
  // le commentaire équivalent dans platforms.js.
  CEMU: { type: 'github-release', repo: 'cemu-project/Cemu' },
  // Project64 n'utilise pas les "Releases" GitHub (0 release), seulement des tags git.
  Project64: { type: 'github-tag', repo: 'project64/project64' },
  Snes9x: { type: 'github-release', repo: 'snes9xgit/snes9x' },
  mGBA: { type: 'github-release', repo: 'mgba-emu/mgba' },
  melonDS: { type: 'github-release', repo: 'melonDS-emu/melonDS' },
  Azahar: { type: 'github-release', repo: 'azahar-emu/azahar' },
  Flycast: { type: 'github-release', repo: 'flyinghead/flycast' },
  PPSSPP: { type: 'github-release', repo: 'hrydgard/ppsspp' }
  // Ryujinx / Eden (Switch) volontairement absents : Nintendo fait retirer les forks
  // de GitHub en continu par DMCA (dépôt qui existe aujourd'hui, bloqué demain) —
  // épingler un nom de dépôt ici casserait en quelques semaines. Pas de source stable
  // disponible pour l'instant.
  // Citra volontairement absent : projet arrêté (retiré de GitHub sur demande de
  // Nintendo en 2024), pas de dépôt de releases fiable à épingler.
  // Xenia volontairement absent : l'exécutable détecté ici est XeniaManager (voir
  // scanner-emulators.js, qui prend le plus gros .exe du dossier — un outil tiers de
  // gestion de bibliothèque/profils, pas le cœur Xenia lui-même), et son dépôt de
  // releases n'a pas été vérifié — pas d'entrée tant que ce n'est pas confirmé.
}

async function fetchJson(url) {
  let response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        // Requis par l'API GitHub (403 sans ça) ; inoffensif ailleurs.
        'User-Agent': 'RetroLib'
      }
    })
  } catch {
    throw new Error('Impossible de contacter le serveur (pas de connexion réseau ?)')
  }
  if (response.status === 404) {
    throw new Error('Page introuvable (404)')
  }
  if (response.status === 403) {
    throw new Error('Limite de requêtes atteinte, réessaie plus tard')
  }
  if (!response.ok) {
    throw new Error(`Le serveur a répondu ${response.status}`)
  }
  return response.json()
}

// Résolution d'un chemin simple "a.b.c" dans un objet JSON (pas de vraie librairie
// JSONPath, inutile pour les cas gérés ici).
function resolvePath(data, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), data)
}

export async function checkEmulatorUpdate(emulatorName) {
  const source = EMULATOR_UPDATE_SOURCES[emulatorName]
  if (!source) {
    throw new Error(`Pas de vérification de mise à jour disponible pour "${emulatorName}"`)
  }

  if (source.type === 'github-release') {
    const data = await fetchJson(`https://api.github.com/repos/${source.repo}/releases/latest`)
    return { latestVersion: data.tag_name, url: data.html_url, publishedAt: data.published_at }
  }

  if (source.type === 'github-tag') {
    const data = await fetchJson(`https://api.github.com/repos/${source.repo}/tags?per_page=1`)
    const tag = data[0]
    if (!tag) throw new Error('Aucun tag trouvé sur ce dépôt')
    return {
      latestVersion: tag.name,
      url: `https://github.com/${source.repo}/releases/tag/${tag.name}`,
      publishedAt: null
    }
  }

  if (source.type === 'custom-json') {
    const data = await fetchJson(source.url)
    const value = resolvePath(data, source.path)
    if (value === undefined) {
      throw new Error(`Champ "${source.path}" introuvable dans la réponse de ${source.url}`)
    }
    return { latestVersion: String(value), url: source.url, publishedAt: null }
  }

  throw new Error(`Type de source inconnu : ${source.type}`)
}
