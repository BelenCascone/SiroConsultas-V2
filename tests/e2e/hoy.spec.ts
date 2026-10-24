/// <reference lib="dom" />
// P3 · Hoy completo: «Ahora» con Atender y No vino, la lista del día y los controles por agendar.
import { test, expect, type Page } from '@playwright/test'

async function entrar(page: Page) {
  await page.goto('/ingresar')
  await page.getByLabel('Clave de prueba').fill('prueba-e2e-123')
  await page.getByRole('button', { name: 'Entrar a la demo' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test.beforeEach(({ page }) => {
  page.on('console', (m) => { if (m.type() === 'error') throw new Error(`Error en la consola: ${m.text()}`) })
  page.on('pageerror', (e) => { throw e })
})

const sinScrollHorizontal = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test('Hoy muestra el turno que sigue, la lista del día y los controles', async ({ page }) => {
  await entrar(page)
  await expect(page.getByRole('region', { name: 'Ahora' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Atender' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'No vino' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Turnos de hoy' })).toContainText('Tomás Ferreyra')
  await expect(page.getByRole('region', { name: 'Controles por agendar' })).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
  // Un turno de la lista abre su ventana sobre la agenda.
  await page.getByRole('link', { name: /Tomás Ferreyra/ }).click()
  await expect(page.getByRole('dialog', { name: 'Tomás Ferreyra' })).toBeVisible()
})

test('No vino cierra el turno, avisa y ofrece darle otro', async ({ page }) => {
  await entrar(page)
  const nombre = (await page.locator('.ahora-nombre').innerText()).split(' ')[0]
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'No vino' }).click()
  await expect(page).toHaveURL(/\/\?ausente=\d+/)
  await expect(page.getByText(`${nombre} quedó como ausente`)).toBeVisible()
  await page.getByRole('link', { name: 'Darle otro turno' }).click()
  await expect(page).toHaveURL(/\/turnos\/nuevo\?paciente=\d+/)
})
