import { reactive } from 'vue'

// Navigation "canapé" : manette (API Gamepad) et clavier en parallèle, par
// déplacement spatial du focus entre les éléments interactifs visibles (le plus proche
// dans la direction demandée). La souris reste utilisable à tout moment : bouger la
// souris masque simplement le cadre de focus.
//
// Manette (mapping standard Xbox / PlayStation) :
//   croix / stick gauche : déplacer      A / ✕ : valider       B / ○ : retour
//   X / □ : fiche du jeu                 Y / △ : favori
//   LB / RB : plateforme (ou filtre) précédente / suivante
//   LT / RT : section précédente / suivante (Jeux, Émulateurs, Stats, Stockage)
// Clavier : flèches, Entrée / Espace, Échap ; Tab reste natif.
//
// Attributs reconnus dans les templates :
//   data-nav-scope   : conteneur modal (popup, panneau) — la navigation y reste confinée
//   data-nav-cancel  : bouton "fermer" d'un data-nav-scope, déclenché par Retour
//   data-nav-default : élément focalisé en premier dans la vue/le conteneur
//   data-nav-skip    : focusable à la souris/Tab mais ignoré par la navigation spatiale
//   data-nav-tab     : entrée de la liste parcourue par LB/RB (l'active a la classe .active)
//   data-nav-mode    : entrée de la liste parcourue par LT/RT (idem)
//   data-game-id     : carte de jeu (cible des boutons X et Y)
//   data-nav-region  : "sidebar" (menu) ou "content" (page affichée), voir move()

export const navState = reactive({
  // 'mouse' | 'keyboard' | 'gamepad' : dernière source d'entrée, pilote l'affichage du
  // cadre de focus (classe sur <html>) et de l'aide des boutons de manette.
  mode: 'mouse',
  gamepadConnected: false,
  gamepadName: ''
})

const FOCUSABLE =
  'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 }
const AXIS_THRESHOLD = 0.5
const REPEAT_DELAY_MS = 380
const REPEAT_RATE_MS = 110

let handlers = { back: () => false, gameAction: () => {} }

function setMode(mode) {
  if (navState.mode === mode) return
  navState.mode = mode
  document.documentElement.classList.toggle('nav-focus', mode !== 'mouse')
}

function isVisible(el) {
  if (el.disabled || el.closest('[inert], [aria-hidden="true"]')) return false
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

// Conteneur modal le plus récent (dernier dans le DOM), sinon tout le document.
function currentScope() {
  const scopes = document.querySelectorAll('[data-nav-scope]')
  return scopes.length ? scopes[scopes.length - 1] : document.body
}

function candidates(scope) {
  return [...scope.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.closest('[data-nav-skip]') && isVisible(el)
  )
}

function focusElement(el) {
  if (!el) return
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

export function focusDefault() {
  const scope = currentScope()
  const preferred = [...scope.querySelectorAll('[data-nav-default]')].find(isVisible)
  if (preferred) return focusElement(preferred)
  const inMain = scope === document.body ? scope.querySelector('main') : null
  const list = candidates(inMain || scope)
  focusElement(list[0] || candidates(scope)[0])
}

// Ne déplace le focus que si on navigue au clavier/à la manette (pas d'effet de bord
// pour l'utilisateur à la souris) — utilisé à l'ouverture/fermeture des pages.
export function focusWhenNavigating(target) {
  if (navState.mode === 'mouse') return
  requestAnimationFrame(() => {
    const el = typeof target === 'string' ? document.querySelector(target) : target
    if (el && isVisible(el)) focusElement(el)
    else focusDefault()
  })
}

function activeInScope(scope) {
  const active = document.activeElement
  if (!active || active === document.body || !scope.contains(active)) return null
  if (active.closest('[data-nav-skip]') || !isVisible(active)) return null
  return active
}

function rangeGap(aStart, aEnd, bStart, bEnd) {
  if (bEnd < aStart) return aStart - bEnd
  if (bStart > aEnd) return bStart - aEnd
  return 0
}

// Choisit l'élément le plus proche dans la direction donnée : distance sur l'axe du
// déplacement (bord à bord) + forte pénalité pour le décalage sur l'axe orthogonal,
// pour rester sur la même ligne/colonne d'une grille quand c'est possible.
function findNext(current, list, direction) {
  const from = current.getBoundingClientRect()
  const fromCx = from.left + from.width / 2
  const fromCy = from.top + from.height / 2
  let best = null
  let bestScore = Infinity
  for (const el of list) {
    if (el === current || el.contains(current) || current.contains(el)) continue
    const to = el.getBoundingClientRect()
    const cx = to.left + to.width / 2
    const cy = to.top + to.height / 2
    let primary
    let ortho
    let centerOrtho
    if (direction === 'right' || direction === 'left') {
      const ahead = direction === 'right' ? to.left >= from.right - 2 : to.right <= from.left + 2
      if (!ahead) continue
      primary = direction === 'right' ? to.left - from.right : from.left - to.right
      ortho = rangeGap(from.top, from.bottom, to.top, to.bottom)
      centerOrtho = Math.abs(cy - fromCy)
    } else {
      const ahead = direction === 'down' ? to.top >= from.bottom - 2 : to.bottom <= from.top + 2
      if (!ahead) continue
      primary = direction === 'down' ? to.top - from.bottom : from.top - to.bottom
      ortho = rangeGap(from.left, from.right, to.left, to.right)
      centerOrtho = Math.abs(cx - fromCx)
    }
    const score = Math.max(primary, 0) + ortho * 4 + centerOrtho * 0.05
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  return best
}

// Passage barre latérale <-> contenu : explicite plutôt que "le plus proche à l'écran"
// (depuis le haut du menu, le plus proche à droite est le champ de recherche de
// l'en-tête, pas la grille). Droite depuis le menu : retour au dernier élément du
// contenu focalisé (la carte qu'on avait quittée), sinon le premier de la vue.
// Gauche depuis le bord du contenu : l'entrée active du menu.
let lastContentFocus = null

function sidebarOf(el) {
  return el?.closest?.('[data-nav-region="sidebar"]') || null
}

function contentRegion() {
  return document.querySelector('[data-nav-region="content"]')
}

function focusContent(scope) {
  const region = contentRegion()
  if (
    lastContentFocus &&
    lastContentFocus.isConnected &&
    region?.contains(lastContentFocus) &&
    scope.contains(lastContentFocus) &&
    isVisible(lastContentFocus) &&
    !lastContentFocus.closest('[data-nav-skip]')
  ) {
    focusElement(lastContentFocus)
    return
  }
  const preferred = region && [...region.querySelectorAll('[data-nav-default]')].find(isVisible)
  if (preferred) return focusElement(preferred)
  const list = region ? candidates(region) : []
  if (list.length) focusElement(list[0])
}

function focusSidebarActive() {
  const sidebar = document.querySelector('[data-nav-region="sidebar"]')
  if (!sidebar) return false
  const active =
    [...sidebar.querySelectorAll('[data-nav-tab].active')].find(isVisible) ||
    [...sidebar.querySelectorAll('[data-nav-mode].active')].find(isVisible) ||
    candidates(sidebar)[0]
  if (!active) return false
  focusElement(active)
  return true
}

function move(direction) {
  const scope = currentScope()
  const current = activeInScope(scope)
  if (!current) {
    focusDefault()
    return
  }
  const inSidebar = sidebarOf(current)
  if (scope === document.body && inSidebar && direction === 'right') {
    focusContent(scope)
    return
  }
  const next = findNext(current, candidates(scope), direction)
  if (scope === document.body && !inSidebar && direction === 'left' && (!next || sidebarOf(next))) {
    if (focusSidebarActive()) return
  }
  if (next) focusElement(next)
}

function onFocusIn(event) {
  const region = contentRegion()
  if (region && region.contains(event.target)) lastContentFocus = event.target
}

function isTextField(el) {
  if (!el) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName !== 'INPUT') return false
  return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(el.type)
}

function activate() {
  const scope = currentScope()
  const el = activeInScope(scope)
  if (!el) {
    focusDefault()
    return
  }
  if (isTextField(el)) return
  if (el.tagName === 'SELECT') {
    // Pas de liste déroulante pilotable à la manette : A passe à l'option suivante.
    if (el.options.length) {
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return
  }
  el.click()
}

function back() {
  const scope = currentScope()
  if (scope !== document.body) {
    const cancel = scope.querySelector('[data-nav-cancel]')
    if (cancel) cancel.click()
    return
  }
  if (handlers.back()) return
  // Rien à fermer : on remonte dans la barre latérale, sur l'entrée active.
  const activeTab = document.querySelector('[data-nav-tab].active, [data-nav-mode].active')
  if (activeTab && !activeTab.contains(document.activeElement)) focusElement(activeTab)
}

function cycle(attribute, delta) {
  const items = [...document.querySelectorAll(`[${attribute}]`)].filter(isVisible)
  if (!items.length) return
  const index = items.findIndex((el) => el.classList.contains('active'))
  const next = items[(index + delta + items.length) % items.length]
  next.click()
  focusElement(next)
}

function gameAction(action) {
  const card = document.activeElement?.closest?.('[data-game-id]')
  handlers.gameAction(action, card?.dataset.gameId || null)
}

// --- Clavier -----------------------------------------------------------------------

const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

function onKeyDown(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target
  const direction = ARROWS[event.key]

  if (direction) {
    // Dans un champ texte, gauche/droite déplacent le curseur ; haut/bas en sortent.
    if (isTextField(target) && (direction === 'left' || direction === 'right')) return
    if (target?.tagName === 'SELECT') return
    event.preventDefault()
    setMode('keyboard')
    move(direction)
    return
  }

  if (event.key === 'Escape') {
    setMode('keyboard')
    if (isTextField(target)) {
      target.blur()
      return
    }
    event.preventDefault()
    back()
    return
  }

  // Entrée/Espace sur un élément focalisable qui n'est pas un bouton natif (carte de
  // jeu en tabindex=0) : équivalent d'un clic, comme pour un vrai bouton.
  if ((event.key === 'Enter' || event.key === ' ') && target?.matches?.('[tabindex]')) {
    if (target.matches('button, a, input, select, textarea')) return
    event.preventDefault()
    setMode('keyboard')
    target.click()
  }
}

// --- Manette -----------------------------------------------------------------------

let previous = {} // nom logique -> pressé à la frame précédente
let repeatState = { direction: null, nextAt: 0 }
let frame = null

function readPads() {
  const pressed = {}
  let any = false
  for (const pad of navigator.getGamepads?.() || []) {
    if (!pad) continue
    any = true
    const btn = (i) => Boolean(pad.buttons[i]?.pressed)
    const x = pad.axes[0] || 0
    const y = pad.axes[1] || 0
    pressed.up ||= btn(BUTTON.UP) || y < -AXIS_THRESHOLD
    pressed.down ||= btn(BUTTON.DOWN) || y > AXIS_THRESHOLD
    pressed.left ||= btn(BUTTON.LEFT) || x < -AXIS_THRESHOLD
    pressed.right ||= btn(BUTTON.RIGHT) || x > AXIS_THRESHOLD
    for (const name of ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT']) {
      pressed[name] ||= btn(BUTTON[name])
    }
  }
  return any ? pressed : null
}

const BUTTON_ACTIONS = {
  A: activate,
  B: back,
  X: () => gameAction('details'),
  Y: () => gameAction('favorite'),
  LB: () => cycle('data-nav-tab', -1),
  RB: () => cycle('data-nav-tab', 1),
  LT: () => cycle('data-nav-mode', -1),
  RT: () => cycle('data-nav-mode', 1)
}

function poll(time) {
  frame = requestAnimationFrame(poll)
  const pressed = readPads()
  if (!pressed) return
  // Fenêtre sans le focus (jeu lancé dans l'émulateur, autre application) : la
  // manette sert au jeu, on l'ignore ici. On mémorise quand même l'état des boutons
  // pour ne pas déclencher d'action au retour sur RetroLib avec un bouton enfoncé.
  if (!document.hasFocus()) {
    previous = pressed
    repeatState = { direction: null, nextAt: 0 }
    return
  }

  for (const [name, action] of Object.entries(BUTTON_ACTIONS)) {
    if (pressed[name] && !previous[name]) {
      setMode('gamepad')
      action()
    }
  }

  const direction = ['up', 'down', 'left', 'right'].find((d) => pressed[d]) || null
  if (!direction) {
    repeatState = { direction: null, nextAt: 0 }
  } else if (direction !== repeatState.direction) {
    setMode('gamepad')
    move(direction)
    repeatState = { direction, nextAt: time + REPEAT_DELAY_MS }
  } else if (time >= repeatState.nextAt) {
    move(direction)
    repeatState.nextAt = time + REPEAT_RATE_MS
  }

  previous = pressed
}

function refreshGamepads() {
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean)
  navState.gamepadConnected = pads.length > 0
  navState.gamepadName = pads[0]?.id?.replace(/\s*\(.*\)\s*$/, '') || ''
  if (!pads.length && navState.mode === 'gamepad') setMode('keyboard')
}

// Chromium émet des mousemove "synthétiques" (déplacement nul) quand le contenu défile
// sous un curseur immobile — ce qui arrive justement quand la navigation fait défiler
// la grille : on ne repasse en mode souris que sur un vrai mouvement ou un clic.
function onPointer(event) {
  if (event.type === 'mousemove' && !event.movementX && !event.movementY) return
  setMode('mouse')
}

export function installNavigation(options) {
  handlers = { ...handlers, ...options }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('focusin', onFocusIn)
  window.addEventListener('mousemove', onPointer, { passive: true })
  window.addEventListener('mousedown', onPointer, { passive: true })
  window.addEventListener('gamepadconnected', refreshGamepads)
  window.addEventListener('gamepaddisconnected', refreshGamepads)
  refreshGamepads()
  frame = requestAnimationFrame(poll)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('focusin', onFocusIn)
    window.removeEventListener('mousemove', onPointer)
    window.removeEventListener('mousedown', onPointer)
    window.removeEventListener('gamepadconnected', refreshGamepads)
    window.removeEventListener('gamepaddisconnected', refreshGamepads)
    cancelAnimationFrame(frame)
  }
}
