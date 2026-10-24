/// <reference lib="dom" />
// P4 · recorrido de punta a punta: cobrar lo que alguien debe, pagar una parte, cobrar lo que falta y anular un pago.
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
  page.on('dialog', (d) => d.accept())
})

const sinScrollHorizontal = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test('cobrar lo que debe Ana: una parte, después el resto', async ({ page }) => {
  await entrar(page)
  await expect(page.getByRole('region', { name: 'Plata de hoy' })).toBeVisible()
  await page.getByRole('link', { name: 'Cobrar', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Cobrar', level: 1 })).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
  await page.getByRole('link', { name: /Ana Gómez/ }).click()
  await expect(page.getByText('Falta pagar')).toBeVisible()
  await page.getByRole('radio', { name: 'Una parte' }).check()
  await page.getByLabel('Si pagó una parte, ¿cuánto?').fill('3.000')
  await page.getByRole('radio', { name: 'Transferencia' }).check()
  await page.getByRole('button', { name: 'Guardar' }).click()
  // El comprobante llega con X4: mientras tanto, «Próximamente».
  await expect(page).toHaveURL(/\/comprobantes\/nuevo\?pago=\d+/)

  await page.goto('/cobros?filtro=deben')
  await page.getByRole('link', { name: /Ana Gómez/ }).click()
  await expect(page.getByText('$ 5.000').first()).toBeVisible()
  await page.getByRole('link', { name: 'Cobrar $ 5.000' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await page.goto('/cobros')
  await page.getByRole('link', { name: /Ana Gómez/ }).click()
  await expect(page.getByText('Pagado', { exact: true })).toBeVisible()
})

test('anular un pago con motivo', async ({ page }) => {
  await entrar(page)
  // El cobro de Ana de los datos ficticios (los recorridos del archivo comparten la base: puede tener más pagos).
  await page.goto('/cobros/1')
  await page.getByText('Anular este pago').first().click()
  await page.getByLabel('Motivo').first().fill('Importe mal cargado')
  await page.getByRole('button', { name: 'Anular el pago' }).first().click()
  await expect(page.getByText('Pago anulado.')).toBeVisible()
  await expect(page.getByText('Anulado: Importe mal cargado')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Cobrar \$/ })).toBeVisible()
})

test('enviar datos de pago sin datos cargados avisa dónde cargarlos', async ({ page }) => {
  await entrar(page)
  await page.goto('/cobros/nuevo?paciente=3&otro=1')
  await page.getByRole('link', { name: 'Enviar datos de pago' }).click()
  const ventana = page.getByRole('dialog', { name: 'Enviar datos de pago' })
  await expect(ventana).toBeVisible()
  await expect(ventana.getByRole('link', { name: /Configuración/ })).toBeVisible()
})
