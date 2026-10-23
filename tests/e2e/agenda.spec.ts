/// <reference lib="dom" />
// P2b · recorrido de punta a punta: la semana, la ventana del turno, mover y cancelar, el día y el mes.
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

test('semana, día y mes sin scroll horizontal', async ({ page }) => {
  await entrar(page)
  await page.getByRole('link', { name: 'Agenda', exact: true }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Semana del')
  expect(await sinScrollHorizontal(page)).toBe(true)
  await page.getByRole('navigation', { name: 'Vista' }).getByRole('link', { name: 'Mes' }).click()
  await expect(page.getByRole('region', { name: 'Turnos del mes' })).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
  await page.getByRole('navigation', { name: 'Vista' }).getByRole('link', { name: 'Día' }).click()
  await expect(page.getByRole('region', { name: 'Turnos del día' })).toBeVisible()
  await expect(page.getByText('Tomás Ferreyra')).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
})

test('la ventana del turno se abre sobre la agenda y al cerrarla todo queda igual', async ({ page }) => {
  await entrar(page)
  await page.goto('/agenda?vista=dia')
  await page.getByRole('link', { name: /Tomás Ferreyra/ }).click()
  const ventana = page.getByRole('dialog', { name: 'Tomás Ferreyra' })
  await expect(ventana).toBeVisible()
  await expect(ventana.getByRole('button', { name: 'Atender' })).toBeVisible()
  await ventana.getByRole('link', { name: 'Cerrar' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).not.toHaveURL(/turno=/)
})

test('mover un turno a un hueco libre y avisarle', async ({ page }) => {
  await entrar(page)
  await page.goto('/agenda?vista=dia')
  await page.getByRole('link', { name: /Tomás Ferreyra/ }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Mover' }).click()
  await expect(page.getByText('Moviendo el turno de Tomás Ferreyra')).toBeVisible()
  // Hoy ya puede no quedar nada: se avanza de a un día hasta encontrar un hueco libre.
  const hueco = page.locator('a.ag-hueco.verde').first()
  for (let i = 0; i < 7 && !(await hueco.isVisible()); i++) await page.getByRole('link', { name: 'Siguiente' }).click()
  await hueco.click()
  const ventana = page.getByRole('dialog', { name: 'Mover el turno de Tomás' })
  await expect(ventana).toBeVisible()
  await ventana.getByRole('button', { name: 'Mover y avisar' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Turno movido')
  await expect(page.getByRole('link', { name: 'Avisarle por WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\//)
})

test('cancelar un turno y dejar el aviso listo', async ({ page }) => {
  await entrar(page)
  await page.goto('/agenda?vista=dia')
  await page.getByRole('link', { name: /Ana Gómez/ }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar y avisar' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Turno cancelado')
  await expect(page.getByRole('link', { name: 'Avisarle por WhatsApp' })).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
})
