/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Recorrido de punta a punta de la etapa 0: entrar a la demo, ver Hoy, usar los componentes y salir.
import { test, expect, type Page } from '@playwright/test'

async function entrar(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/ingresar$/)
  await page.getByLabel('Clave de prueba').fill('prueba-e2e-123')
  await page.getByRole('button', { name: 'Entrar a la demo' }).click()
  await expect(page).toHaveURL(/\/$/)
}

const sinScrollHorizontal = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.beforeEach(({ page }) => {
  page.on('console', (m) => { if (m.type() === 'error') throw new Error(`Error en la consola: ${m.text()}`) })
  page.on('pageerror', (e) => { throw e })
})

test('entra a la demo y ve Hoy con los turnos del día', async ({ page }) => {
  await entrar(page)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Julia')
  const turnos = page.getByRole('region', { name: 'Turnos de hoy' })
  await expect(turnos.getByText('Tomás Ferreyra')).toBeVisible()
  await expect(turnos.getByText('Lucía Benítez')).toBeVisible()
  await expect(turnos.getByText('Primera consulta').first()).toBeVisible()
  // En el celular el menú de arriba pasa a la barra de abajo (P6).
  const menu = test.info().project.name.endsWith('celular') ? 'Secciones' : 'Menú principal'
  await expect(page.getByRole('navigation', { name: menu }).getByRole('link', { name: 'Hoy' })).toHaveAttribute('aria-current', 'page')
  expect(await sinScrollHorizontal(page)).toBe(true)
})

test('la clave equivocada no entra', async ({ page }) => {
  await page.goto('/ingresar')
  await page.getByLabel('Clave de prueba').fill('otra')
  await page.getByRole('button', { name: 'Entrar a la demo' }).click()
  await expect(page.getByRole('alert')).toContainText('La clave no es correcta')
})

test('componentes: la ventana se abre sobre la pantalla y al cerrarla todo queda igual', async ({ page }) => {
  await entrar(page)
  await page.goto('/componentes')
  expect(await sinScrollHorizontal(page)).toBe(true)
  const ventana = page.getByRole('dialog', { name: 'Cobrar a Tomás Ferreyra' })
  await expect(ventana).toBeHidden()
  await page.getByRole('button', { name: 'Abrir una ventana' }).click()
  await expect(ventana).toBeVisible()
  await ventana.getByRole('radio', { name: 'Transferencia' }).click()
  await expect(ventana.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
  await ventana.getByRole('button', { name: 'Cerrar' }).click()
  await expect(ventana).toBeHidden()
  await page.getByRole('button', { name: 'Abrir una ventana' }).click()
  await page.keyboard.press('Escape')
  await expect(ventana).toBeHidden()
})

test('los controles miden al menos 44 px', async ({ page }) => {
  await entrar(page)
  await page.goto('/componentes')
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll('main .boton, main .pastilla, main .entrada, .cabecera .redondo')]
      .map((el) => ({ texto: (el.textContent || el.getAttribute('aria-label') || '').trim(), alto: el.getBoundingClientRect().height }))
      .filter((x) => x.alto > 0 && x.alto < 44))).toEqual([])
})

test('salir cierra la sesión', async ({ page }) => {
  await entrar(page)
  await page.getByRole('button', { name: 'Salir' }).click()
  await expect(page).toHaveURL(/\/ingresar$/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/ingresar$/)
})
