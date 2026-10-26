/// <reference lib="dom" />
// P6 · Celular de la profesional: barra de abajo, «Llegó», la hoja del turno, la agenda del día y la ficha sin lo clínico.
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

test('la barra de abajo lleva a Hoy, Agenda, Pacientes y Pedidos', async ({ page }) => {
  await entrar(page)
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeHidden()
  const barra = page.getByRole('navigation', { name: 'Secciones' })
  await expect(barra).toBeVisible()
  await expect(barra.getByRole('link', { name: 'Hoy' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('se hacen desde la compu')).toBeVisible()

  await barra.getByRole('link', { name: 'Agenda' }).click()
  await expect(page.getByRole('navigation', { name: 'Días' }).getByRole('link')).toHaveCount(7)
  await expect(page.getByRole('link', { name: 'Semana' })).toBeHidden()
  expect(await sinScrollHorizontal(page)).toBe(true)
  await page.getByRole('link', { name: 'Mes', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Turnos del mes' })).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)

  await barra.getByRole('link', { name: 'Pacientes' }).click()
  await expect(page.getByRole('heading', { name: 'Pacientes', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Filtrar pacientes' }).getByRole('link', { name: /Primera consulta/ })).toBeHidden()
  await barra.getByRole('link', { name: 'Pedidos' }).click()
  await expect(page.getByRole('heading', { name: 'Pedidos de turno' })).toBeVisible()
})

test('la hoja del turno muestra su resumen y al cerrarla vuelve a Hoy', async ({ page }) => {
  await entrar(page)
  await page.getByRole('region', { name: 'Turnos de hoy' }).getByRole('link', { name: /Lucía Benítez/ }).click()
  const hoja = page.getByRole('dialog', { name: 'Lucía Benítez' })
  await expect(hoja).toBeVisible()
  await expect(hoja.getByText('Alergias', { exact: true })).toBeVisible()
  await expect(hoja.getByText('Última consulta')).toBeVisible()
  await expect(hoja.getByRole('button', { name: 'Llegó' })).toBeVisible()
  await expect(hoja.getByRole('button', { name: 'Atender' })).toBeHidden()
  await hoja.getByRole('link', { name: 'Cerrar' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('«Llegó» deja el turno en consulta sin salir de Hoy', async ({ page }) => {
  await entrar(page)
  const nombre = (await page.locator('.ahora-nombre').innerText()).split(' ')[0]
  await page.getByRole('region', { name: 'Ahora' }).getByRole('button', { name: 'Llegó' }).click()
  await expect(page).toHaveURL(/\/\?llego=\d+/)
  await expect(page.getByText(`${nombre} quedó en consulta. Las notas clínicas las escribís en la compu.`)).toBeVisible()
})

test('cancelar desde la agenda del día pide quién lo cancela', async ({ page }) => {
  await entrar(page)
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Agenda' }).click()
  await page.getByRole('list', { name: 'Turnos del día' }).getByRole('link', { name: /Ana Gómez/ }).click()
  await page.getByRole('dialog', { name: 'Ana Gómez' }).getByRole('link', { name: 'Cancelar y avisar' }).click()
  const hoja = page.getByRole('dialog', { name: 'Cancelar el turno de Ana' })
  await expect(hoja.getByText('¿Quién lo cancela?')).toBeVisible()
  await hoja.getByRole('radio', { name: 'Ana' }).check()
  await hoja.getByRole('button', { name: 'Cancelar el turno' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Turno cancelado')
  await expect(page.getByRole('link', { name: 'Avisarle por WhatsApp' })).toHaveAttribute('href', /como%20nos%20pediste/)
})

test('la ficha es un resumen sin lo clínico', async ({ page }) => {
  await entrar(page)
  await page.goto('/pacientes')
  await page.getByRole('link', { name: /Ana Gómez/ }).first().click()
  const resumen = page.getByRole('region', { name: 'Resumen' })
  await expect(resumen).toBeVisible()
  await expect(resumen.getByText('Alergias', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Editar datos' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dar turno' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Debe · Cobrar/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Historia clínica' })).toBeHidden()
  await expect(page.getByText('La historia clínica, las notas y los documentos se ven en la compu.')).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
})
