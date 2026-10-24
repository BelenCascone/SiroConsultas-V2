import { defineConfig, devices } from '@playwright/test'

// Pruebas de punta a punta contra `wrangler dev`. Cada archivo de tests/e2e corre en notebook (1366×657) y en celular (390 px),
// que pesan igual, y cada combinación tiene su propio servidor con una base local nueva (tests/e2e/servidor.mjs):
// los recorridos no se pisan los datos ni dependen del orden.
const ARCHIVOS = ['ingreso', 'pacientes', 'configuracion', 'turnos', 'agenda', 'consultas', 'bloqueos', 'hoy', 'documentos', 'cobros'] as const
const VISTAS = [
  { nombre: 'notebook', viewport: { width: 1366, height: 657 } },
  { nombre: 'celular', viewport: { width: 390, height: 844 }, hasTouch: true },
] as const
// Configuración, consultas y documentos: solo la pantalla de compu está aprobada (X1–X3).
const SOLO_NOTEBOOK: readonly string[] = ['configuracion', 'consultas', 'documentos']
const COMBINACIONES = ARCHIVOS.flatMap((archivo) =>
  VISTAS.filter((vista) => !SOLO_NOTEBOOK.includes(archivo) || vista.nombre === 'notebook').map((vista) => ({ archivo, vista })))
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
  projects: COMBINACIONES.map(({ archivo, vista }, i) => ({
    name: `${archivo}-${vista.nombre}`,
    testMatch: `${archivo}.spec.ts`,
    use: { ...devices['Desktop Chrome'], viewport: vista.viewport, hasTouch: 'hasTouch' in vista, baseURL: `http://127.0.0.1:${puerto(i)}` },
  })),
  webServer: COMBINACIONES.map((_, i) => ({
    command: `node tests/e2e/servidor.mjs ${puerto(i)}`,
    url: `http://127.0.0.1:${puerto(i)}/salud`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  })),
})
