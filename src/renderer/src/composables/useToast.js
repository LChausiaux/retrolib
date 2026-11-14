import { ref, onUnmounted } from 'vue'

// Petit message en haut de l'écran qui disparaît tout seul (manette connectée, dos de
// boîte ajoutés, nouveaux jeux détectés...).
export function useToast(durationMs = 3500) {
  const toast = ref(null)
  let timer = null

  function showToast(text) {
    toast.value = text
    clearTimeout(timer)
    timer = setTimeout(() => (toast.value = null), durationMs)
  }

  onUnmounted(() => clearTimeout(timer))

  return { toast, showToast }
}
