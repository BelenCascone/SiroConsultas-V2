import { defineConfig, devices } from '@playwright/test'

// Pruebas de punta a punta contra `wrangler dev`. Cada archivo de tests/e2e corre contra su propio servidor con una
// base local nueva (tests/e2e/servidor.mjs). Se prueba en notebook (1366×657) y en celular (390 px): pesan igual.
const ARCHIVOS = ['ingreso'] as const
const puerto = (i: number) => 8790 + i

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'retain-on-failure',
  },
  projects: ARCHIVOS.flatMap((nombre, i) => [
    { name: `${nombre}-notebook`, testMatch: `${nombre}.spec.ts`, use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 657 }, baseURL: `http://127.0.0.1:${puerto(i)}` } },
    { name: `${nombre}-celular`, testMatch: `${nombre}.spec.ts`, use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: true, baseURL: `http://127.0.0.1:${puerto(i)}` } },
  ]),
  webServer: ARCHIVOS.map((_, i) => ({
    command: `node tests/e2e/servidor.mjs ${puerto(i)}`,
    url: `http://127.0.0.1:${puerto(i)}/salud`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  })),
})
