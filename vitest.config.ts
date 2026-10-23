import { defineConfig } from 'vitest/config'

// Pruebas de la base (triggers sobre SQLite en memoria) y de la app real con un D1 de prueba.
// Las de punta a punta van con Playwright (playwright.config.ts). El JSX se configura en tsconfig.json.
export default defineConfig({
  test: {
    include: ['tests/base/**/*.test.ts', 'tests/unidad/**/*.test.ts'],
    environment: 'node',
  },
})
