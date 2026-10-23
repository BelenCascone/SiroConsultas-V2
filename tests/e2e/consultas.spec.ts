/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { test, expect, type Page } from '@playwright/test'

const estado = (page: Page) => page.locator('[data-consulta-estado]')
const form = (page: Page) => page.locator('[data-consulta-formulario]')
async function paciente(page: Page, completo = true) {
  const dni = String(80000000 + Math.floor(Math.random() * 10000000))
  const postear = (ruta: string, datos: Record<string, string>) => page.evaluate(async ({ ruta, datos }) => {
    const respuesta = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(datos) })
    return { ok: respuesta.ok, url: respuesta.url, estado: respuesta.status }
  }, { ruta, datos })
  const alta = await postear('/pacientes', { dni, nombre: 'Paciente', apellido: `Ficticio ${dni}`, celular: '3430000000', correo: '' })
  expect(alta.estado).toBe(200)
  const id = new URL(alta.url).pathname.split('/')[2]
  if (completo) {
    const r = await postear('/consultas/completar-ficha', { paciente: id, turno: '', fecha_nacimiento: '1990-02-10', domicilio: 'Calle Ficticia 123', ocupacion: 'Docente', cobertura: 'particular' })
    expect(r.estado).toBe(200)
  }
  return id
}
async function guardar(page: Page) {
  const respuesta = page.waitForResponse(r => r.url().endsWith('/consultas/guardar'))
  await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click()
  expect((await respuesta).ok()).toBe(true)
  await expect(estado(page)).toContainText('Borrador guardado')
}
async function escribir(page: Page) {
  await page.getByLabel('Motivo de consulta y anamnesis').fill('Dolor cervical ficticio')
  await page.getByLabel('Plan e indicaciones', { exact: true }).fill('Ejercicios ficticios y control')
  await guardar(page)
}
async function firmar(page: Page) {
  await page.getByRole('button', { name: 'Terminar consulta', exact: true }).click()
  const ventana = page.getByRole('dialog', { name: '¿Terminás la consulta?' })
  await expect(ventana).toBeVisible()
  await ventana.getByRole('button', { name: 'Sí, terminar y firmar' }).click()
  await expect(page.getByRole('heading', { name: 'Consulta terminada', exact: true })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
  await page.goto('/ingresar')
  await page.getByLabel('Clave de prueba').fill('prueba-e2e-123')
  await page.getByRole('button', { name: 'Entrar a la demo' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('primera vez: completa ficha, crea borrador al guardar, firma con signos y agrega aclaración', async ({ page }) => {
  const id = await paciente(page, false)
  await page.goto(`/consultas/nueva?paciente=${id}`)
  await expect(page.getByRole('heading', { name: 'Completá la ficha de Paciente' })).toBeVisible()
  await page.getByLabel('Nacimiento').fill('1990-02-10')
  await page.getByLabel('Cobertura', { exact: true }).selectOption('particular')
  await page.getByLabel('Domicilio', { exact: true }).fill('Calle Ficticia 123')
  await page.getByLabel('Ocupación', { exact: true }).fill('Docente')
  await page.getByRole('button', { name: 'Guardar y empezar la consulta' }).click()
  await expect(estado(page)).toContainText('Todavía sin guardar')
  await expect(form(page).locator('[name=version]')).toHaveValue('0')
  await page.getByLabel('Motivo de consulta y anamnesis').fill('Dolor cervical ficticio')
  await page.getByRole('button', { name: 'Ninguno en enfermedades', exact: true }).click()
  await page.getByLabel('Alergias', { exact: true }).fill('Penicilina')
  await page.locator('summary').filter({ hasText: 'Signos vitales' }).click()
  await page.getByLabel('Peso (kg)', { exact: true }).fill('72,5')
  await page.getByLabel('Presión (mmHg)', { exact: true }).fill('120/80')
  await page.getByLabel('Plan e indicaciones', { exact: true }).fill('Ejercicios ficticios y control')
  await page.getByRole('button', { name: '2 semanas', exact: true }).click()
  await guardar(page)
  await expect(page).toHaveURL(/\/consultas\/\d+$/)
  await firmar(page)
  await expect(page.locator('main')).toContainText('Peso: 72,5 kg')
  await expect(page.locator('main')).toContainText('Penicilina')
  await page.getByLabel('Aclaración', { exact: true }).fill('Aclaración ficticia posterior')
  await page.getByRole('button', { name: 'Agregar aclaración' }).click()
  await expect(page.locator('main')).toContainText('Aclaración ficticia posterior')
  await expect(page.locator('[data-consulta-formulario]')).toHaveCount(0)
})

test('historia: empezar sin turno, retomar y copiar el plan de la consulta anterior', async ({ page }) => {
  const id = await paciente(page)
  await page.goto(`/pacientes/${id}?tab=historia`)
  await page.getByRole('link', { name: 'Empezar consulta sin turno' }).click()
  await escribir(page)
  const url = page.url()
  await page.getByRole('link', { name: 'Ver toda la historia', exact: true }).click()
  await page.getByRole('link', { name: /Primera consulta/ }).click()
  await expect(page).toHaveURL(url)
  await expect(page.getByLabel('Plan e indicaciones', { exact: true })).toHaveValue('Ejercicios ficticios y control')
  await firmar(page)
  await page.goto(`/pacientes/${id}?tab=historia`)
  await page.getByRole('link', { name: 'Empezar consulta sin turno' }).click()
  await expect(page.getByLabel('Evolución', { exact: true })).toBeVisible()
  await page.getByLabel('Evolución', { exact: true }).fill('Mejoró desde la última vez')
  await page.getByRole('button', { name: 'Copiar las de la vez anterior' }).click()
  await expect(page.getByLabel('Plan e indicaciones', { exact: true })).toHaveValue('Ejercicios ficticios y control')
  await guardar(page)
  await firmar(page)
})

test('dos pestañas: rechaza la versión vieja y conserva el texto local', async ({ page, context }) => {
  const id = await paciente(page)
  await page.goto(`/consultas/nueva?paciente=${id}`)
  await escribir(page)
  const otra = await context.newPage()
  await otra.goto(page.url())
  await page.getByLabel('Plan e indicaciones', { exact: true }).fill('Plan de la pestaña que guardó primero')
  await guardar(page)
  await otra.getByLabel('Plan e indicaciones', { exact: true }).fill('Texto local de la pestaña vieja')
  await expect(otra.locator('[data-consulta-error]')).toContainText('otra pestaña')
  await expect(otra.getByLabel('Plan e indicaciones', { exact: true })).toHaveValue('Texto local de la pestaña vieja')
  await page.reload()
  await expect(page.getByLabel('Plan e indicaciones', { exact: true })).toHaveValue('Plan de la pestaña que guardó primero')
  await otra.close()
})

test('autoguardado en cola: escribir mientras guarda no pierde el último cambio', async ({ page }) => {
  const id = await paciente(page)
  await page.goto(`/consultas/nueva?paciente=${id}`)
  let liberar!: () => void, entro!: () => void, primero = true
  const bloqueo = new Promise<void>(resolver => { liberar = resolver })
  const capturado = new Promise<void>(resolver => { entro = resolver })
  await page.route('**/consultas/guardar', async ruta => {
    if (primero) { primero = false; entro(); await bloqueo }
    await ruta.continue()
  })
  await page.getByLabel('Motivo de consulta y anamnesis').fill('Motivo antes de guardar')
  await capturado
  await page.getByLabel('Plan e indicaciones', { exact: true }).fill('Último cambio mientras se guarda')
  liberar()
  await expect.poll(async () => Number(await form(page).locator('[name=version]').inputValue())).toBeGreaterThanOrEqual(2)
  await expect(estado(page)).toContainText('Borrador guardado')
  await page.reload()
  await expect(page.getByLabel('Plan e indicaciones', { exact: true })).toHaveValue('Último cambio mientras se guarda')
})

test('error de red: avisa sin perder el texto y permite reintentar', async ({ page }) => {
  const id = await paciente(page)
  await page.goto(`/consultas/nueva?paciente=${id}`)
  await page.route('**/consultas/guardar', ruta => ruta.abort())
  await page.getByLabel('Motivo de consulta y anamnesis').fill('Texto que no tiene que perderse')
  await expect(page.locator('[data-consulta-error]')).toContainText('El texto sigue en esta pantalla')
  await expect(page.getByLabel('Motivo de consulta y anamnesis')).toHaveValue('Texto que no tiene que perderse')
  await page.unroute('**/consultas/guardar')
  await guardar(page)
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
  await page.reload()
  await expect(page.getByLabel('Motivo de consulta y anamnesis')).toHaveValue('Texto que no tiene que perderse')
})

test('estudios: guarda el borrador pendiente antes de adjuntar y permite descargar el original', async ({ page }) => {
  const id = await paciente(page)
  await page.goto(`/consultas/nueva?paciente=${id}`)
  await page.getByLabel('Motivo de consulta y anamnesis').fill('Evaluación ficticia con estudio')
  await page.getByRole('button', { name: 'Adjuntar estudio', exact: true }).click()
  const ventana = page.getByRole('dialog', { name: 'Adjuntar estudio', exact: true })
  await ventana.getByLabel('Nombre del estudio').fill('Estudio ficticio.pdf')
  await ventana.getByLabel('Archivo del estudio').setInputFiles({ name: 'estudio.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 estudio ficticio') })
  await ventana.getByRole('button', { name: 'Guardar estudio' }).click()
  await expect(page.getByRole('link', { name: 'Estudio ficticio.pdf' })).toBeVisible()
  await expect(page.getByLabel('Motivo de consulta y anamnesis')).toHaveValue('Evaluación ficticia con estudio')
  const descarga = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Estudio ficticio.pdf' }).click()
  expect((await descarga).suggestedFilename()).toBe('Estudio ficticio.pdf')
})

test('descarte con motivo y mediciones fuera de consulta desde la historia', async ({ page }) => {
  const id = await paciente(page)
  await page.goto(`/consultas/nueva?paciente=${id}`)
  await escribir(page)
  await page.locator('summary').filter({ hasText: 'Descartar borrador' }).click()
  await page.getByLabel('Motivo del descarte').fill('Se abrió por error')
  await page.getByRole('button', { name: 'Descartar con motivo' }).click()
  await expect(page.locator('main')).toContainText('Se abrió por error')
  await page.getByLabel('Medición', { exact: true }).selectOption('peso')
  await page.getByLabel('Valor', { exact: true }).fill('76')
  await page.getByRole('button', { name: 'Guardar medición' }).click()
  await expect(page.locator('main')).toContainText('Peso: 76 kg')
})

test('entrada de P2 por turno y controles visibles en notebook, sin estilos ni scripts en línea', async ({ page }) => {
  await page.goto('/consultas/nueva?turno=3')
  await page.getByRole('button', { name: 'Sí, atender y empezar' }).click()
  await expect(page.getByLabel('Evolución', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('main [style], main [onclick], main script').count()).toBe(0)
  await expect.poll(async () => page.locator('main .boton, main .pastilla, main input:not([type=hidden]), main textarea, main select').evaluateAll(elementos => elementos.filter(el => {
    const r = el.getBoundingClientRect(); return r.height > 0 && r.height < 44
  }).map(el => el.outerHTML))).toEqual([])
})
