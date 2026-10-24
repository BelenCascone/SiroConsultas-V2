/// <reference lib="dom" />
import {test,expect,type Page} from '@playwright/test'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'

// Datos ficticios de este recorrido. P4 crea los pagos; X4 no implementa ni suplanta esa ruta.
function pagoFicticio(baseURL:string) {
  const id=60000000+Math.floor(Math.random()*10000000),puerto=new URL(baseURL).port
  const sql=`INSERT INTO cobros(id,paciente_id,concepto,importe,fecha) VALUES (${id},2,'Pago ficticio X4',123400,date('now','-3 hours')); INSERT INTO pagos(id,cobro_id,importe,medio,fecha) VALUES (${id},${id},123400,'efectivo',date('now','-3 hours'))`
  execFileSync('node_modules/.bin/wrangler',['d1','execute','DB','--local','--persist-to',`.wrangler/e2e/${puerto}`,'--command',sql],{stdio:'pipe',env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}})
  return id
}
async function entrar(page:Page){await page.goto('/ingresar');await page.getByLabel('Clave de prueba').fill('prueba-e2e-123');await page.getByRole('button',{name:'Entrar a la demo'}).click();await expect(page).toHaveURL(/\/$/)}
test.beforeEach(async({page})=>{page.on('pageerror',e=>{throw e});await entrar(page)})

test('configura datos fiscales, transferencia, logo y diseño; emite un PDF estable',async({page,baseURL})=>{
  const pago=pagoFicticio(baseURL!)
  await page.goto('/configuracion/cobros')
  await expect(page.getByRole('heading',{name:'Datos fiscales',exact:true})).toBeVisible()
  await page.getByLabel('CUIT',{exact:true}).fill('20111111112')
  await page.getByLabel('Condición frente al IVA').selectOption('monotributo')
  await page.getByLabel('Domicilio fiscal').fill('Calle Ficticia 123')
  await page.getByLabel('Punto de venta',{exact:true}).fill('1')
  await page.getByLabel('Alias',{exact:true}).fill('alias.ficticio')
  await page.getByLabel('CBU o CVU').fill('1234567489012345678902')
  await page.getByLabel('Titular',{exact:true}).fill('Profesional ficticia')
  await page.getByLabel('Logo del comprobante',{exact:true}).setInputFiles('tests/fixtures/comprobante-logo.png')
  await page.getByRole('radio',{name:'Violeta',exact:true}).check()
  await page.getByLabel('Pie del comprobante',{exact:true}).fill('Gracias por tu visita ficticia')
  await expect(page.getByRole('region',{name:'Vista previa del diseño'})).toContainText('Gracias por tu visita ficticia')
  await expect(page.locator('[data-comp-previa]')).toHaveClass(/comp-violeta/)
  await page.getByLabel('Correo de tu contadora',{exact:true}).fill('contadora@example.test')
  await page.getByRole('button',{name:'Guardar cambios',exact:true}).click()
  await expect(page.getByText('Guardaste los cambios.',{exact:true})).toBeVisible()
  await page.goto(`/comprobantes/nuevo?pago=${pago}`)
  await expect(page.getByRole('radio',{name:'Factura C · llega en la etapa 4'})).toBeDisabled()
  await expect(page.getByLabel('Nombre y apellido del receptor')).toBeHidden()
  await page.getByRole('button',{name:'Emitir comprobante interno',exact:true}).click()
  await expect(page.getByText('Comprobante emitido',{exact:true})).toBeVisible()
  const url=page.url()
  const descarga=page.waitForEvent('download');await page.getByRole('link',{name:'Descargar PDF',exact:true}).click()
  const original=await readFile((await(await descarga).path())!)
  expect(original.subarray(0,8).toString()).toBe('%PDF-1.7')
  expect(original.includes(Buffer.from('/Subtype /Image'))).toBe(true)
  await page.goto('/configuracion/cobros')
  await page.getByLabel('Pie del comprobante',{exact:true}).fill('Pie nuevo para los próximos comprobantes')
  await page.getByRole('button',{name:'Guardar cambios',exact:true}).click()
  await page.goto(url)
  await expect(page.getByRole('region',{name:'Vista previa del comprobante'})).toContainText('Gracias por tu visita ficticia')
  await expect(page.getByRole('region',{name:'Vista previa del comprobante'})).not.toContainText('Pie nuevo para los próximos comprobantes')
  const otra=page.waitForEvent('download');await page.getByRole('link',{name:'Descargar PDF',exact:true}).click()
  expect((await readFile((await(await otra).path())!)).equals(original)).toBe(true)
  await expect(page.getByRole('link',{name:'Por WhatsApp',exact:true})).toHaveAttribute('href',/^https:\/\/wa.me\//)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('otra persona, reintento del mismo pago y anulación delegada a P4',async({page,baseURL})=>{
  const pago=pagoFicticio(baseURL!)
  await page.goto(`/comprobantes/nuevo?pago=${pago}`)
  await page.getByRole('radio',{name:'Otra persona',exact:true}).check()
  await page.getByLabel('Nombre y apellido del receptor').fill('Persona Ficticia')
  await page.getByLabel('Tipo de documento').selectOption('cuit')
  await page.getByLabel('DNI o CUIT del receptor').fill('20111111112')
  await page.getByRole('button',{name:'Emitir comprobante interno',exact:true}).click()
  const url=page.url()
  await expect(page.getByRole('region',{name:'Vista previa del comprobante'})).toContainText('Persona Ficticia')
  await page.goto(`/comprobantes/nuevo?pago=${pago}`)
  await expect(page).toHaveURL(url)
  await page.getByText('Anular el pago',{exact:true}).click()
  await expect(page.locator(`form[action="/pagos/${pago}/anular"]`)).toBeVisible()
  await page.getByLabel('Motivo de anulación').fill('Error ficticio de carga')
  await expect(page.locator(`form[action="/pagos/${pago}/anular"] [name=motivo]`)).toHaveValue('Error ficticio de carga')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('permite posponer sin emitir y conserva los datos al corregir la configuración',async({page,baseURL})=>{
  const pago=pagoFicticio(baseURL!)
  await page.goto(`/comprobantes/nuevo?pago=${pago}`)
  await expect(page.getByRole('link',{name:'Ahora no',exact:true})).toHaveAttribute('href','/cobros')
  await page.goto('/configuracion/cobros')
  await page.getByLabel('CUIT',{exact:true}).fill('20111111111')
  await page.getByLabel('Titular',{exact:true}).fill('Titular ficticio conservado')
  await page.getByRole('button',{name:'Guardar cambios',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Revisá el CUIT')
  await expect(page.getByLabel('Titular',{exact:true})).toHaveValue('Titular ficticio conservado')
  await page.goto(`/comprobantes/nuevo?pago=${pago}`)
  await expect(page.getByRole('button',{name:'Emitir comprobante interno',exact:true})).toBeVisible()
})
