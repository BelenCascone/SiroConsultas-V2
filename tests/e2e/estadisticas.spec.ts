/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import {test,expect,type Page} from '@playwright/test'
import {execFileSync} from 'node:child_process'

const hoyAR=()=>new Date(Date.now()-3*3600_000).toISOString().slice(0,10)
async function entrar(page:Page) {
  await page.goto('/ingresar');await page.getByLabel('Clave de prueba').fill('prueba-e2e-123');await page.getByRole('button',{name:'Entrar a la demo'}).press('Enter');await expect(page).toHaveURL(/\/$/)
}
function datosFicticios(baseURL:string) {
  const id=60000000+Math.floor(Math.random()*1000000),mes=hoyAR().slice(0,7)
  const sql=`INSERT INTO pacientes(id,dni,nombre,apellido,celular) VALUES (${id},'${70000000+id%1000000}','Paciente','Estadísticas ficticias','3430000000');
    INSERT INTO turnos(id,paciente_id,consultorio_id,fecha,hora,duracion_min,prestacion_id,cobertura) VALUES
    (${id},${id},2,'${mes}-05','09:00',30,2,'particular'),(${id+1},${id},2,'${mes}-06','09:00',30,2,'particular'),(${id+2},${id},2,'${mes}-07','09:00',30,2,'particular');
    UPDATE turnos SET estado='atendido',cerrado_en='${mes}-07T14:00:00Z' WHERE id IN (${id},${id+1},${id+2});
    INSERT INTO consultas(id,paciente_id,turno_id,consultorio_id,tipo) VALUES (${id},${id},${id+2},2,'control');
    UPDATE consultas SET estado='finalizada',finalizada_en='${mes}-07T14:00:00Z',foto='{"paciente":{"cobertura":"particular"}}',motivo='PRIVADO-X5-NO-MOSTRAR' WHERE id=${id};
    INSERT INTO cobros(id,paciente_id,turno_id,consultorio_id,prestacion_id,concepto,importe,fecha) VALUES (${id},${id},${id+2},2,2,'Control ficticio X5',120001,'${mes}-07');
    INSERT INTO pagos(cobro_id,importe,medio,fecha) VALUES (${id},30001,'efectivo','${mes}-08'),(${id},20002,'transferencia','${mes}-09');`
  execFileSync('node_modules/.bin/wrangler',['d1','execute','DB','--local','--persist-to',`.wrangler/e2e/${new URL(baseURL).port}`,'--command',sql],{stdio:'pipe',env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}})
  return {id,mes}
}
const valor=(page:Page,nombre:string)=>page.getByRole('region',{name:nombre,exact:true}).locator('[data-est-valor]')
test.beforeEach(async({page})=>{page.on('pageerror',e=>{throw e});await entrar(page)})

test('consultas sin duplicar, cobros exactos y filtros de consultorio',async({page,baseURL})=>{
  datosFicticios(baseURL!)
  await page.getByRole('navigation',{name:'Menú principal'}).getByRole('link',{name:'Estadísticas',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Estadísticas',exact:true})).toBeVisible()
  await page.getByLabel('Consultorio',{exact:true}).selectOption('2')
  await page.getByRole('button',{name:'Aplicar consultorio'}).click()
  await expect(valor(page,'Consultas')).toHaveText('3')
  await expect(valor(page,'Primera vez')).toHaveText('1')
  await expect(valor(page,'Pacientes que vuelven')).toHaveText('2')
  await expect(valor(page,'Cobrado')).toHaveText('$ 500,03')
  await expect(valor(page,'Particulares')).toHaveText('$ 500,03')
  await expect(valor(page,'Copagos')).toHaveText('$ 0')
  await expect(page.getByRole('table',{name:'Consultas y cobros por prestación'})).toContainText('$ 500,03')
  await expect(page.getByText('PRIVADO-X5-NO-MOSTRAR')).toHaveCount(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(await page.locator('[style]').count()).toBe(0)
})

test('gráfico SVG navegable, detalle del mes y tabla accesible equivalente',async({page})=>{
  await page.goto('/estadisticas?consultorio=2')
  const grafico=page.getByRole('group',{name:/^Consultas por mes:/})
  await expect(grafico).toBeVisible()
  await expect(grafico.getByRole('link')).toHaveCount(6)
  const mesAntiguo=await grafico.getByRole('link').first().getAttribute('href')
  await grafico.getByRole('link').first().click()
  await expect(page).toHaveURL(new RegExp('mes='+new URL(mesAntiguo!,'http://localhost').searchParams.get('mes')))
  await expect(page.getByRole('region',{name:'Detalle del mes'})).toContainText('consultas en total')
  await page.getByRole('link',{name:'Ver como tabla',exact:true}).click()
  const tabla=page.getByRole('table',{name:'Primera vez y pacientes que vuelven, por mes'})
  await expect(tabla).toBeVisible();await expect(tabla.locator('tbody tr')).toHaveCount(6)
  await expect(page.getByLabel('Consultorio',{exact:true})).toHaveValue('2')
  await tabla.getByRole('link').last().click()
  await expect(page.getByRole('region',{name:'Detalle del mes'})).toBeVisible()
  await page.getByRole('link',{name:'Ver gráfico',exact:true}).click()
  await expect(grafico).toBeVisible()
})

test('mes anterior, trimestre, rango libre y enlace a la contadora',async({page})=>{
  await page.goto('/estadisticas')
  await page.getByRole('link',{name:'Mes anterior',exact:true}).click()
  await expect(page).toHaveURL(/periodo=anterior/)
  await page.getByRole('link',{name:'Trimestre',exact:true}).click()
  await expect(page).toHaveURL(/periodo=trimestre/)
  await page.getByRole('link',{name:'Elegir fechas',exact:true}).click()
  await page.getByLabel('Desde',{exact:true}).fill('2035-02-01')
  await page.getByLabel('Hasta',{exact:true}).fill('2035-02-28')
  await page.getByRole('button',{name:'Aplicar fechas'}).click()
  await expect(valor(page,'Consultas')).toHaveText('0')
  await expect(valor(page,'Cobrado')).toHaveText('$ 0')
  const destino=page.getByRole('link',{name:'Enviar a la contadora',exact:true})
  await expect(destino).toHaveAttribute('href','/contadora?periodo=fechas&desde=2035-02-01&hasta=2035-02-28')
  await destino.click()
  await expect(page).toHaveURL(/\/contadora\?/)
  await expect(page.getByRole('heading',{name:'Enviar a la contadora',exact:true})).toBeVisible()
})

test.describe('Sin JavaScript',()=>{
  test.use({javaScriptEnabled:false,contextOptions:{reducedMotion:'reduce'}})
  test('se puede usar sin JavaScript: filtros, gráfico y tabla son del servidor',async({page})=>{
    await page.goto('/estadisticas')
    await page.getByRole('link',{name:'Ver como tabla',exact:true}).click()
    await expect(page.getByRole('table',{name:'Primera vez y pacientes que vuelven, por mes'})).toBeVisible()
    await page.getByLabel('Consultorio',{exact:true}).selectOption('sin')
    await page.getByRole('button',{name:'Aplicar consultorio'}).click()
    await expect(page.getByLabel('Consultorio',{exact:true})).toHaveValue('sin')
    await expect(page.getByRole('link',{name:'Ver gráfico',exact:true})).toBeVisible()
  })
})
