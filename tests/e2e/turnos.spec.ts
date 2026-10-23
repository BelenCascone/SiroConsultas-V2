/// <reference lib="dom" />
// P2a · recorrido de punta a punta: dar un turno a un paciente que ya vino y a uno nuevo.
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

test('dar turno en tres pasos y avisarle por WhatsApp', async ({ page }) => {
  await entrar(page)
  await page.getByRole('link', { name: 'Dar turno' }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dar turno')
  await page.getByLabel('Buscar paciente').fill('ferreyra')
  await page.getByLabel('Buscar paciente').press('Enter')
  await page.getByRole('link', { name: /Tomás Ferreyra/ }).click()
  await expect(page.getByText('Tomás Ferreyra · cambiar')).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
  await page.locator('a.hueco').first().click()
  await expect(page.getByRole('heading', { name: 'Revisá y guardá' })).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
  await page.getByRole('button', { name: /Guardar/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Turno dado')
  await expect(page.getByRole('link', { name: 'Avisarle por WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/5493431111111\?text=/)
  await page.getByRole('link', { name: 'Ver ficha' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tomás Ferreyra')
})

test('paciente nuevo desde Dar turno', async ({ page }) => {
  await entrar(page)
  await page.goto('/turnos/nuevo')
  await page.getByRole('link', { name: 'Paciente nuevo' }).click()
  await page.getByLabel('DNI').fill('46.111.222')
  await page.getByLabel('Nombre').fill('Lara')
  await page.getByLabel('Apellido').fill('Méndez')
  await page.getByLabel('Celular').fill('343 155-0000')
  await page.getByRole('button', { name: 'Guardar y seguir' }).click()
  await expect(page.getByText('Lara Méndez · cambiar')).toBeVisible()
  await page.locator('a.hueco').first().click()
  await page.getByRole('button', { name: /Guardar/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Turno dado')
  await expect(page.getByText('Lara Méndez')).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
})
