import { ref, watch } from 'vue'

// Préférence d'affichage mémorisée d'une session à l'autre (localStorage). Une valeur
// absente, inconnue ou illisible (stockage indisponible) retombe sur "fallback".
export function usePreference(key, allowed, fallback) {
  let initial = fallback
  try {
    const stored = localStorage.getItem(key)
    if (allowed.includes(stored)) initial = stored
  } catch {
    // Stockage indisponible : valeur par défaut.
  }
  const value = ref(initial)
  watch(value, (next) => {
    try {
      localStorage.setItem(key, next)
    } catch {
      // Préférence non mémorisée, sans conséquence.
    }
  })
  return value
}
