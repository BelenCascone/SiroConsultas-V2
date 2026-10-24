/// <reference lib="dom" />
// P3 · bloquear la agenda, resolver un turno (mover) y decidir un feriado, de punta a punta.
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
/** Fecha de Argentina dentro de n días (la semilla deja un turno a +2 días). */
const en = (dias: number) => new Date(Date.now() - 3 * 3600_000 + dias * 86_400_000).toISOString().slice(0, 10)

test('bloquear un día con un turno, moverlo a un horario sugerido y volver a la lista', async ({ page }) => {
  await entrar(page)
  await page.goto('/')
  await page.getByRole('link', { name: 'Bloquear agenda' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Bloquear la agenda' })).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)

  // El aviso se recalcula solo al cambiar un dato.
  await page.goto(`/bloqueos/nuevo?desde=${en(2)}&hasta=${en(2)}`)
  await expect(page.getByText('Ya tenés 1 turno en esos días')).toBeVisible()
  await page.getByRole('radio', { name: 'Una franja' }).check()
  await expect(page.getByLabel('Desde la hora')).toBeVisible()
  await page.getByRole('radio', { name: 'Todo el día' }).check()
  await expect(page.getByLabel('Desde la hora')).toHaveCount(0)
  await page.getByRole('radio', { name: 'Congreso' }).check()
  await expect(page.getByText('Ya tenés 1 turno en esos días')).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)

  await page.getByRole('button', { name: /^Bloquear el / }).click()
  await expect(page.getByText(/Agenda bloqueada el .* · congreso/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Falta resolver 1 turno' })).toBeVisible()
  await expect(page.getByText('Martín Sosa')).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)

  await page.getByRole('link', { name: 'Mover' }).click()
  await expect(page.getByText('Primeros huecos libres después del bloqueo')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Elegí un horario' })).toHaveCount(0) // es un texto, no un botón
  await expect(page.getByText('Elegí un horario')).toBeVisible()
  await page.locator('.resolver-panel a.pastilla[aria-pressed]').first().click()
  await page.getByRole('button', { name: /^Mover al .* y avisar$/ }).click()
  await expect(page.getByRole('heading', { name: 'Turno movido' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Avisarle por WhatsApp' })).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
  await page.getByRole('link', { name: 'Seguir con los turnos' }).click()
  await expect(page.getByRole('heading', { name: 'Todo resuelto' })).toBeVisible()
})

test('«Que elija el paciente» deja los horarios reservados y el WhatsApp listo', async ({ page }) => {
  await entrar(page)
  // Se da un turno de prueba en Centro (lunes, miércoles o viernes), en el primer día que no sea feriado.
  let dia = ''
  for (let n = 5; n < 20 && !dia; n++) {
    const f = en(n)
    if (![1, 3, 5].includes(new Date(f + 'T00:00:00Z').getUTCDay())) continue
    await page.goto(`/turnos/nuevo?paciente=2&consultorio=1&prestacion=2&fecha=${f}&hora=09:00`)
    const guardar = page.getByRole('button', { name: 'Guardar turno' })
    if (await guardar.count()) { await guardar.click(); dia = f }
  }
  expect(dia).not.toBe('')
  await page.goto(`/bloqueos/nuevo?desde=${dia}&hasta=${dia}&consultorio=1`)
  await page.getByRole('button', { name: /^Bloquear el / }).click()
  await expect(page.getByRole('heading', { name: 'Falta resolver 1 turno' })).toBeVisible()
  await page.getByRole('link', { name: 'Mover' }).click()
  await page.getByRole('button', { name: 'Que elija el paciente' }).click()
  await expect(page.getByText(/Reservamos 3 horarios/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Todo resuelto' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mandar los horarios por WhatsApp' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Eligió el / })).toHaveCount(3)
  expect(await sinScrollHorizontal(page)).toBe(true)
})

test('feriados: decidir si atendés y quitar un bloqueo', async ({ page }) => {
  await entrar(page)
  await page.goto('/bloqueos/nuevo')
  const feriados = page.getByRole('region', { name: 'Próximos feriados' })
  await expect(feriados).toBeVisible()
  const primero = feriados.getByRole('form').first()
  await primero.getByRole('button', { name: 'No', exact: true }).click()
  await expect(feriados.getByRole('form').first().getByRole('button', { name: 'No', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await feriados.getByRole('form').first().getByRole('button', { name: 'Sí', exact: true }).click()
  await expect(feriados.getByRole('form').first().getByRole('button', { name: 'Sí', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await sinScrollHorizontal(page)).toBe(true)

  await page.goto(`/bloqueos/nuevo?desde=${en(30)}&hasta=${en(31)}`)
  await page.getByRole('button', { name: /^Bloquear del / }).click()
  await expect(page.getByRole('heading', { name: 'Todo resuelto' })).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Quitar este bloqueo' }).click()
  await expect(page.getByText('Bloqueo quitado')).toBeVisible()
})
