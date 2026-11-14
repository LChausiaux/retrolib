import { defineConfig } from 'vitest/config'

// Tests unitaires des modules sans dépendance à Electron (voir tests/).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node'
  }
})
