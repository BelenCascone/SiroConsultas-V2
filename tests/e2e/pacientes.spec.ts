/// <reference lib="dom" />
// P1 · recorrido de punta a punta: buscar, dar de alta, completar la ficha, dar de baja y reactivar.
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

test('buscar sin tildes y abrir la ficha', async ({ page }) => {
  await entrar(page)
  await page.getByRole('link', { name: 'Pacientes', exact: true }).click()
  await page.getByLabel('Buscar paciente').fill('gomez')
  await page.getByLabel('Buscar paciente').press('Enter')
  await expect(page.getByRole('region', { name: 'Lista de pacientes' }).getByText('Ana Gómez')).toBeVisible()
  await expect(page.getByText('Tomás Ferreyra')).toHaveCount(0)
  await page.getByText('Ana Gómez').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ana Gómez')
  await expect(page.getByText('Cobrar $ 8.000')).toBeVisible()
  expect(await sinScrollHorizontal(page)).toBe(true)
})

test('alta rápida, completar la ficha y ver que deja de estar incompleta', async ({ page }) => {
  await entrar(page)
  await page.goto('/pacientes')
  await page.getByRole('link', { name: 'Paciente nuevo' }).click()
  const alta = page.getByRole('dialog', { name: 'Paciente nuevo' })
  await expect(alta).toBeVisible()
  await alta.getByLabel('DNI').fill('46.111.222')
  await alta.getByLabel('Nombre').fill('Lara')
  await alta.getByLabel('Apellido').fill('Méndez')
  await alta.getByLabel('Celular').fill('11 5555-0140')
  await alta.getByRole('button', { name: 'Guardar paciente' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lara Méndez')
  await expect(page.getByText('Ficha incompleta')).toBeVisible()

  await page.getByRole('link', { name: 'Editar datos' }).click()
  const editar = page.getByRole('dialog', { name: 'Editar datos' })
  await editar.getByLabel('Nacimiento').fill('1995-05-20')
  await editar.getByLabel('Domicilio').fill('Calle Ficticia 9')
  await editar.getByLabel('Ocupación').fill('Diseñadora')
  await editar.getByLabel('Cobertura').selectOption({ label: 'OSDE' })
  await editar.getByLabel('N.º de afiliado').fill('99-111')
  await editar.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('Cambios guardados.')).toBeVisible()
  await expect(page.getByText('Ficha incompleta')).toHaveCount(0)
  await expect(page.getByText('OSDE · 99-111')).toBeVisible()
})

test('el mismo DNI lleva a la ficha que ya existe', async ({ page }) => {
  await entrar(page)
  await page.goto('/pacientes/nuevo')
  await page.getByLabel('DNI').fill('30111222')
  await page.getByLabel('Nombre').fill('Otro')
  await page.getByLabel('Apellido').fill('Nombre')
  await page.getByLabel('Celular').fill('3430000000')
  await page.getByRole('button', { name: 'Guardar paciente' }).click()
  await expect(page.getByText('Ese DNI ya era de Tomás Ferreyra')).toBeVisible()
})

test('dar de baja cancela el turno y se puede reactivar', async ({ page }) => {
  await entrar(page)
  await page.goto('/pacientes/1')
  await page.getByRole('link', { name: 'Editar datos' }).click()
  await page.getByRole('dialog', { name: 'Editar datos' }).getByRole('link', { name: 'Dar de baja al paciente' }).click()
  const baja = page.getByRole('dialog', { name: 'Dar de baja a Tomás Ferreyra' })
  await expect(baja).toBeVisible()
  await expect(baja.getByText(/Tiene un turno el/)).toBeVisible()
  await baja.getByRole('radio', { name: 'Se mudó' }).click()
  await baja.getByRole('button', { name: 'Dar de baja a Tomás' }).click()
  await expect(page.getByText('quedó dado de baja')).toBeVisible()
  await expect(page.getByText('Se canceló su turno')).toBeVisible()
  await page.getByRole('button', { name: 'Reactivar' }).click()
  await expect(page.getByText('está activo otra vez')).toBeVisible()
})

test('a quien debe no se lo puede dar de baja', async ({ page }) => {
  await entrar(page)
  await page.goto('/pacientes/2?baja=1')
  await expect(page.getByText('Para darlo de baja primero tiene que quedar al día')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dar de baja a Ana' })).toBeDisabled()
})
