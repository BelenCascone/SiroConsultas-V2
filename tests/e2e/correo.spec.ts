/// <reference lib="dom" />
// P5 · recorrido de punta a punta: la planilla de la contadora, el mensaje del recordatorio y el recordatorio desde la agenda.
// En la demo no hay servidor de correo: los envíos se simulan.
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

test('enviar a la contadora: descargar la planilla, cargar el correo y enviar', async ({ page }) => {
  await entrar(page)
  await page.goto('/cobros')
  await page.getByRole('link', { name: /Enviar a la contadora/ }).click()
  await expect(page.getByRole('heading', { name: 'Enviar a la contadora', level: 1 })).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
  await expect(page.getByText('Todavía no cargaste el correo de tu contadora.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Enviar / })).toBeDisabled()

  await page.getByRole('link', { name: 'Elegir fechas' }).click()
  await page.getByLabel('Desde').fill('2026-01-01')
  await page.getByLabel('Hasta').fill('2026-03-31')
  await page.getByRole('button', { name: 'Ver el período' }).click()
  await expect(page.getByRole('button', { name: 'Enviar del 1/1 al 31/3' })).toBeVisible()
  const descarga = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Solo descargar la planilla' }).click()
  expect((await descarga).suggestedFilename()).toBe('cobros_2026-01-01_a_2026-03-31.xlsx')
  await page.goto('/contadora')
  await expect(page.getByText('Primer trimestre')).toBeVisible()
  await expect(page.getByText(/descargada el/)).toBeVisible()

  await page.getByRole('link', { name: 'Cargarlo' }).click()
  await page.getByLabel('Correo de tu contadora').fill('contadora@ejemplo.test')
  await page.getByRole('button', { name: 'Guardar cambios' }).last().click()
  await expect(page.getByText('Guardaste los cambios.')).toBeVisible()
  await page.goto('/contadora')
  await expect(page.getByText('contadora@ejemplo.test')).toBeVisible()
  await page.getByRole('link', { name: 'Septiembre' }).click()
  await page.getByRole('button', { name: 'Enviar septiembre' }).click()
  await expect(page.getByText('Enviado. Te llegó una copia a tu correo.')).toBeVisible()
  await expect(page.getByText(/enviado el .* a contadora@ejemplo\.test/)).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
})

test('el mensaje del recordatorio se ve mientras se escribe y se guarda', async ({ page }, info) => {
  await entrar(page)
  await page.goto('/configuracion/recordatorios')
  // Configuración se usa en la compu (análisis, «Solo en la compu»): su diseño de celular no está aprobado.
  if (info.project.name.endsWith('notebook')) expect(await sinScrollHorizontal(page)).toBe(true)
  const previa = page.locator('#r-previa')
  await expect(previa).toContainText('Hola Diego, te recordamos tu turno el')
  await page.getByLabel('Mensaje').fill('Hola {nombre}, te espero el {dia} a las {hora}. {lugar}')
  await expect(previa).toContainText('Hola Diego, te espero el')
  await expect(previa).toContainText('a las 17:00. Consultorio Centro')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('Guardaste los cambios.')).toBeVisible()
  await expect(page.getByLabel('Mensaje')).toHaveValue('Hola {nombre}, te espero el {dia} a las {hora}. {lugar}')
  await page.getByRole('button', { name: 'Volver al mensaje original' }).click()
  await expect(page.getByText('Volviste al mensaje original.')).toBeVisible()
  await expect(page.getByLabel('Mensaje')).toHaveValue(/te recordamos tu turno/)
})

test('el turno de los próximos días ofrece mandar el recordatorio', async ({ page }) => {
  await entrar(page)
  const fecha = new Date(Date.now() - 3 * 3600_000 + 2 * 86400_000).toISOString().slice(0, 10)
  await page.goto(`/agenda?vista=dia&fecha=${fecha}`)
  await page.getByRole('link', { name: /Martín/ }).first().click()
  await expect(page.getByRole('dialog')).toContainText('Todavía no se lo mandaste')
  await expect(page.getByRole('button', { name: 'Mandar recordatorio' })).toBeVisible()
})
