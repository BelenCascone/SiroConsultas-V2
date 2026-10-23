/// <reference lib="dom" />
// P2 · recorrido de punta a punta: dar turno desde un hueco de la agenda, moverlo, cancelarlo y darlo con un paciente nuevo.
import { test, expect, type Page } from '@playwright/test'
import { ahoraAR, sumarDias } from '../../src/lib/fechas'
import { lunesDe } from '../../src/lib/agenda'

// El lunes de la semana que viene: el consultorio Centro atiende de 8 a 12 y de 15 a 19 (datos ficticios).
const lunes = lunesDe(sumarDias(ahoraAR().fecha, 7))

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

async function darTurnoAAna(page: Page, hora: string) {
  await page.goto(`/agenda?fecha=${lunes}`)
  expect(await sinScrollHorizontal(page)).toBe(true)
  await page.getByRole('link', { name: new RegExp(`^Hueco libre el lunes .* a las ${hora}$`) }).click()
  await expect(page.getByRole('heading', { name: '¿Para quién es?' })).toBeVisible()
  await page.getByRole('link', { name: /Ana Gómez/ }).click()
  await expect(page.getByRole('heading', { name: 'Revisá y guardá' })).toBeVisible()
  await page.getByRole('button', { name: 'Guardar turno' }).click()
  await expect(page.getByRole('heading', { name: 'Turno confirmado' })).toBeVisible()
  await page.getByRole('link', { name: 'Volver', exact: true }).click()
}

test('dar turno desde un hueco de la agenda', async ({ page }) => {
  await entrar(page)
  await darTurnoAAna(page, '08:00')
  await expect(page).toHaveURL(new RegExp(`/agenda\\?fecha=${lunes}`))
  await expect(page.getByRole('link', { name: /08:00 Ana Gómez/ })).toBeVisible()
  // El hueco de las 8 ya no se ofrece
  await expect(page.getByRole('link', { name: new RegExp(`^Hueco libre el lunes .* a las 08:00$`) })).toHaveCount(0)
})

test('mover un turno a otro hueco y ver el aviso para mandarle', async ({ page }) => {
  await entrar(page)
  await darTurnoAAna(page, '08:30')
  await page.getByRole('link', { name: /08:30 Ana Gómez/ }).click()
  const ventana = page.getByRole('dialog', { name: 'Ana Gómez' })
  await expect(ventana).toBeVisible()
  await ventana.getByRole('link', { name: 'Mover' }).click()
  await expect(page.getByText('Moviendo el turno de Ana Gómez')).toBeVisible()
  await page.getByRole('link', { name: new RegExp(`^Mover al lunes .* a las 11:00$`) }).click()
  const mover = page.getByRole('dialog', { name: 'Mover el turno de Ana Gómez' })
  await expect(mover).toBeVisible()
  await mover.getByRole('button', { name: 'Mover' }).click()
  await expect(page.getByText(/pasó al .* a las 11:00/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Avisarle por WhatsApp' })).toBeVisible()
})

test('cancelar porque el paciente avisó que no viene', async ({ page }) => {
  await entrar(page)
  await darTurnoAAna(page, '09:00')
  await page.getByRole('link', { name: /09:00 Ana Gómez/ }).click()
  const ventana = page.getByRole('dialog', { name: 'Ana Gómez' })
  await ventana.getByText('Cancelar y avisar').click()
  await ventana.getByRole('radio', { name: 'Avisó que no viene' }).click()
  await ventana.getByRole('button', { name: 'Cancelar el turno' }).click()
  await expect(page.getByText(/Se canceló el turno de Ana Gómez/)).toBeVisible()
  await page.getByRole('link', { name: 'Listo' }).click()
  await expect(page.getByRole('link', { name: /09:00 Ana Gómez/ })).toHaveCount(0)
})

test('dar turno a un paciente nuevo eligiendo día y hora', async ({ page }) => {
  await entrar(page)
  await page.goto('/turnos/nuevo')
  await page.getByRole('link', { name: 'Paciente nuevo' }).click()
  await page.getByLabel('DNI').fill('47.000.222')
  await page.getByLabel('Nombre').fill('Valentina')
  await page.getByLabel('Apellido').fill('González')
  await page.getByLabel('Celular').fill('11 5555-0142')
  await page.getByRole('button', { name: 'Crear ficha y seguir' }).click()
  await expect(page.getByRole('heading', { name: '¿Cuándo?' })).toBeVisible()
  await page.goto(page.url() + `&dia=${lunes}`)
  await page.getByRole('link', { name: '15:00', exact: true }).click()
  await expect(page.getByText('Valentina González').first()).toBeVisible()
  await page.getByRole('button', { name: 'Guardar turno' }).click()
  await expect(page.getByRole('heading', { name: 'Turno confirmado' })).toBeVisible()
  await expect(page.getByText(/Valentina González · .* a las 15:00/)).toBeVisible()
})
