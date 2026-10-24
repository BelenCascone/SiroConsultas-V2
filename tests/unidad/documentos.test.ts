import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { entorno, CLAVE_PRUEBA, ORIGEN, SECRETO, navegador } from './ayuda'
import { firmar } from '../../src/lib/firma'
import { contextoFirmado } from '../../src/lib/consultas'
import { pdf, sha256 } from '../../src/lib/documentos'

const fuente = new Uint8Array(readFileSync('public/fuentes/documentos-dejavu-sans.ttf'))
const ajax = { Accept: 'application/json' }
async function preparado(modulos = 'agenda,documentos,cobros') {
  const objetos = new Map<string,Uint8Array>()
  const t = entorno({ MODULOS: modulos, ASSETS: { fetch: async () => new Response(fuente) } as unknown as Fetcher, ARCHIVOS: {
    put: async (clave:string,b:Uint8Array,op?: {onlyIf?:unknown}) => { if(op?.onlyIf && objetos.has(clave)) return null; objetos.set(clave,new Uint8Array(b)); return {key:clave} },
    get: async (clave:string) => objetos.has(clave) ? { arrayBuffer: async () => objetos.get(clave)!.slice().buffer } : null,
    delete: async (clave:string) => { objetos.delete(clave) },
  } as unknown as R2Bucket })
  // El adaptador general usa run() en batch; D1 también devuelve filas para SELECT.
  const original=t.env.DB, lecturas=new WeakSet<object>()
  t.env.DB={...original,prepare(sql:string) { const st=original.prepare(sql);if(/^SELECT/i.test(sql)) lecturas.add(st);return st },async batch(sentencias:D1PreparedStatement[]) {
    t.db.exec('BEGIN')
    try { const r=[];for(const st of sentencias) r.push(await(lecturas.has(st) ? st.all() : st.run()));t.db.exec('COMMIT');return r } catch(e) {t.db.exec('ROLLBACK');throw e}
  }} as D1Database
  await t.navegador.pedir('/ingresar/prueba',{form:{clave:CLAVE_PRUEBA}})
  return {...t,objetos}
}
async function formulario(tipo='certificado',id=70001,paciente=1,consulta:number|null=null) {
  return { documento_contexto: await firmar(JSON.stringify({id,paciente,consulta,tipo}),SECRETO),diagnostico:'Diagnóstico ficticio: tensión cervical, β y ñ.',dias:'2',estudios:'Hemograma\nGlucemia', medicamento:'Medicación ficticia',indicaciones:'Una indicación ficticia',fecha:'2026-01-01' }
}
const emitir = async (t:Awaited<ReturnType<typeof preparado>>, tipo='certificado',id=70001) => {
  const r = await t.navegador.pedir('/documentos/emitir',{form:await formulario(tipo,id),headers:ajax})
  expect(r.status,await r.clone().text()).toBe(200)
  return r.json() as Promise<{id:number;url:string;pdf:string|null}>
}
// Lectura independiente de los registros locales ZIP (sin compresión); se exige el directorio y cierre.
function abrirZip(b:Uint8Array) {
  const v = new DataView(b.buffer,b.byteOffset,b.byteLength), archivos = new Map<string,Uint8Array>()
  let p=0
  while(v.getUint32(p,true)===0x04034b50) {
    expect(v.getUint16(p+8,true)).toBe(0)
    const n=v.getUint16(p+26,true),extra=v.getUint16(p+28,true),tam=v.getUint32(p+18,true)
    const nombre=new TextDecoder().decode(b.slice(p+30,p+30+n)),inicio=p+30+n+extra
    archivos.set(nombre,b.slice(inicio,inicio+tam));p=inicio+tam
  }
  expect(v.getUint32(p,true)).toBe(0x02014b50)
  expect(v.getUint32(b.length-22,true)).toBe(0x06054b50)
  expect(v.getUint16(b.length-12,true)).toBe(archivos.size)
  return archivos
}

describe('Documentos clínicos privados',()=>{
  it('exige sesión, módulo habilitado, mismo origen y contexto firmado',async()=>{
    const t=await preparado(),sinSesion=navegador(t.env)
    expect((await sinSesion.pedir('/documentos/nuevo?paciente=1')).status).toBe(302)
    expect((await t.navegador.pedir('/documentos/emitir',{form:await formulario(),headers:{Origin:'https://otro.test'}})).status).toBe(403)
    expect((await t.navegador.pedir('/documentos/emitir',{form:{documento_contexto:'falso'},headers:ajax})).status).toBe(400)
    const apagado=await preparado('agenda')
    expect((await apagado.navegador.pedir('/documentos/nuevo?paciente=1')).status).toBe(404)
    expect((await apagado.navegador.pedir('/pacientes/1?tab=documentos')).status).toBe(404)
    expect(await(await apagado.navegador.pedir('/pacientes/1')).text()).not.toContain('data-documento-form')
    expect((await apagado.navegador.pedir('/pacientes/1/exportar')).status).toBe(200)
  })
  it('emite el PDF una sola vez y conserva sus bytes, paciente y profesional originales',async()=>{
    const t=await preparado(),d=await emitir(t)
    const r=await t.navegador.pedir(d.pdf!),original=new Uint8Array(await r.arrayBuffer())
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect(new TextDecoder().decode(original.slice(0,8))).toBe('%PDF-1.7')
    const fila=t.db.prepare('SELECT * FROM documentos WHERE id=70001').get()!
    expect(fila.pdf_sha256).toBe(await sha256(original))
    expect(JSON.parse(String(fila.datos)).paciente.dni).toBeTruthy()
    t.db.prepare("UPDATE profesional SET nombre='Otra Profesional',matricula='MP 999' WHERE id=1").run()
    const repetido=await t.navegador.pedir('/documentos/emitir',{form:{...await formulario(),diagnostico:'Otro diagnóstico'},headers:ajax})
    expect(repetido.status).toBe(200)
    expect(t.objetos.size).toBe(1)
    expect(Buffer.from(await(await t.navegador.pedir(d.pdf!)).arrayBuffer()).equals(Buffer.from(original))).toBe(true)
    expect(t.db.prepare('SELECT COUNT(*) n FROM documentos').get()!.n).toBe(1)
    expect(t.db.prepare("SELECT COUNT(*) n FROM auditoria WHERE evento='documento_creado'").get()!.n).toBe(1)
  })
  it('pide nombre y matrícula y valida campos sin generar archivos parciales',async()=>{
    const t=await preparado()
    for(const cambio of [{diagnostico:''},{dias:'0'},{dias:'-1'},{dias:'1.5'},{dias:'10000'}]) {
      const r=await t.navegador.pedir('/documentos/emitir',{form:{...await formulario(),...cambio},headers:ajax})
      expect(r.status).toBeGreaterThanOrEqual(400)
    }
    t.db.prepare("UPDATE profesional SET matricula=NULL WHERE id=1").run()
    expect((await t.navegador.pedir('/documentos/emitir',{form:await formulario(),headers:ajax})).status).toBe(409)
    expect(t.objetos.size).toBe(0)
  })
  it('genera pedidos con un estudio por renglón y diagnóstico opcional',async()=>{
    const t=await preparado()
    const r=await t.navegador.pedir('/documentos/emitir',{form:{...await formulario('pedido'),diagnostico:''},headers:ajax})
    expect(r.status).toBe(200)
    const datos=JSON.parse(String(t.db.prepare('SELECT datos FROM documentos WHERE id=70001').get()!.datos))
    expect(datos.estudios).toEqual(['Hemograma','Glucemia'])
    expect(datos.diagnostico).toBe('')
  })
  it('registra MisRx sin inventar una receta PDF ni enviar mensajes',async()=>{
    const t=await preparado(),d=await emitir(t,'medicacion')
    expect(d.pdf).toBeNull();expect(t.objetos.size).toBe(0)
    const fila=t.db.prepare('SELECT * FROM documentos WHERE id=70001').get()!
    expect(fila.fecha).toBe('2026-01-01');expect(JSON.parse(String(fila.datos)).origen).toBe('MisRx')
    for(const fecha of ['2026-02-30','2999-01-01']) expect((await t.navegador.pedir('/documentos/emitir',{form:{...await formulario('medicacion',70002),fecha},headers:ajax})).status).toBe(422)
  })
  it('exige consulta de la misma ficha y permite documentos posteriores a la firma',async()=>{
    const t=await preparado()
    expect((await t.navegador.pedir('/documentos/emitir',{form:await formulario('certificado',70001,1,333),headers:ajax})).status).toBe(409)
    await t.navegador.pedir('/consultas/guardar',{form:{contexto:await contextoFirmado({id:333,paciente:1,turno:null},SECRETO),version:'0',motivo:'Ficticio',plan:'Plan ficticio',personales:'Ninguno',alergias:'Ninguno',medicacion:'Ninguno',familiares:'Ninguno'},headers:ajax})
    expect((await t.navegador.pedir('/documentos/emitir',{form:await formulario('certificado',70001,2,333),headers:ajax})).status).toBe(409)
    expect((await t.navegador.pedir('/documentos/emitir',{form:await formulario('certificado',70001,1,333),headers:ajax})).status).toBe(200)
  })
  it('anula con motivo sin borrar ni reemplazar el original, y rechaza otra anulación',async()=>{
    const t=await preparado(),d=await emitir(t)
    expect((await t.navegador.pedir(`${d.url}/anular`,{form:{motivo:''},headers:ajax})).status).toBe(422)
    const antes=t.objetos.get('documentos/1/certificado/70001')!.slice()
    expect((await t.navegador.pedir(`${d.url}/anular`,{form:{motivo:'Error ficticio de carga'}})).status).toBe(303)
    expect((await t.navegador.pedir(`${d.url}/anular`,{form:{motivo:'Otro'}})).status).toBe(409)
    expect(Buffer.from(await(await t.navegador.pedir(d.pdf!)).arrayBuffer()).equals(Buffer.from(antes))).toBe(true)
    const html=await(await t.navegador.pedir('/pacientes/1?tab=documentos')).text()
    expect(html).toContain('<del>Certificado</del>');expect(html).toContain('Error ficticio de carga')
  })
  it('una ficha dada de baja permite leer pero impide emitir y anular',async()=>{
    const t=await preparado(),d=await emitir(t)
    t.db.prepare("UPDATE pacientes SET baja_en='2026-01-01T00:00:00Z',baja_motivo='otro' WHERE id=1").run()
    expect((await t.navegador.pedir('/documentos/emitir',{form:await formulario('certificado',70002),headers:ajax})).status).toBe(409)
    expect((await t.navegador.pedir(`${d.url}/anular`,{form:{motivo:'Ficticio'}})).status).toBe(409)
    expect((await t.navegador.pedir(d.pdf!)).status).toBe(200)
  })
  it('detecta la alteración o ausencia del original en R2',async()=>{
    const t=await preparado(),d=await emitir(t)
    t.objetos.set('documentos/1/certificado/70001',new Uint8Array([1,2,3]))
    expect((await t.navegador.pedir(d.pdf!,{headers:ajax})).status).toBe(409)
    t.objetos.clear()
    expect((await t.navegador.pedir(d.pdf!,{headers:ajax})).status).toBe(404)
  })
  it('adjunta estudios con validación de contenido y huella, sin confundirlos con PDFs emitidos',async()=>{
    const t=await preparado(),form=new FormData()
    form.set('documento_contexto',(await formulario('estudio')).documento_contexto)
    form.set('nombre','Estudio ficticio')
    form.set('archivo',new File(['<script>falso</script>'],'falso.pdf',{type:'application/pdf'}))
    const pedir=()=>t.navegador.pedir('/documentos/emitir',{method:'POST',body:form,headers:{...ajax,Origin:ORIGEN}})
    expect((await pedir()).status).toBe(422)
    form.set('archivo',new File(['%PDF-1.7\nFicticio'],'estudio.pdf',{type:'application/pdf'}))
    expect((await pedir()).status).toBe(200)
    expect(t.db.prepare('SELECT sha256 FROM archivos WHERE id=70001').get()!.sha256).toBe(await sha256(t.objetos.get('documentos/1/estudio/70001')!))
    expect((await t.navegador.pedir('/documentos/estudios/70001/archivo')).headers.get('content-type')).toBe('application/pdf')
  })
})

describe('Exportación completa y formato de los archivos',()=>{
  it('exporta originales anulados, MisRx, PDF, JSON y LEEME con huellas verificables y auditoría',async()=>{
    const t=await preparado(),d=await emitir(t)
    const original=t.objetos.get('documentos/1/certificado/70001')!.slice()
    await emitir(t,'pedido',70002);await emitir(t,'medicacion',70003)
    await t.navegador.pedir(`${d.url}/anular`,{form:{motivo:'Motivo ficticio'}})
    const res=await t.navegador.pedir('/pacientes/1/exportar',{form:{}})
    expect(res.status).toBe(200);expect(res.headers.get('content-type')).toBe('application/zip')
    const archivos=abrirZip(new Uint8Array(await res.arrayBuffer()))
    expect(Buffer.from(archivos.get('documentos/70001_ANULADO_certificado.pdf')!).equals(Buffer.from(original))).toBe(true)
    const historia=JSON.parse(new TextDecoder().decode(archivos.get('historia.json')))
    expect(historia.documentos).toHaveLength(3)
    expect(historia.documentos[0].anulado_motivo).toBe('Motivo ficticio')
    expect(historia.paciente.id).toBe(1)
    expect(historia).not.toHaveProperty('sesiones')
    expect(archivos.has('historia.pdf')).toBe(true)
    const leeme=new TextDecoder().decode(archivos.get('LEEME.txt'))
    for(const [nombre,b] of archivos) if(nombre!=='LEEME.txt') expect(leeme).toContain(`${await sha256(b)}  ${nombre}`)
    expect(t.db.prepare("SELECT COUNT(*) n FROM auditoria WHERE evento='historia_exportada'").get()!.n).toBe(1)
  })
  it('incluye la foto firmada, aclaraciones, mediciones y estudios anulados originales',async()=>{
    const t=await preparado(),contexto=await contextoFirmado({id:99001,paciente:1,turno:null},SECRETO)
    const guardado=await t.navegador.pedir('/consultas/guardar',{form:{contexto,version:'0',motivo:'Motivo ficticio',plan:'Plan ficticio',personales:'Ninguno',alergias:'Ninguno',medicacion:'Ninguno',familiares:'Ninguno',signo_peso:'70'},headers:ajax})
    expect(guardado.status).toBe(200)
    expect((await t.navegador.pedir('/consultas/finalizar',{form:{contexto,version:'1'}})).status).toBe(303)
    const foto=t.db.prepare('SELECT foto FROM consultas WHERE id=99001').get()!.foto
    t.db.prepare('INSERT INTO aclaraciones(consulta_id,texto) VALUES (?,?)').run(99001,'Aclaración ficticia posterior')
    t.db.prepare("UPDATE pacientes SET nombre='Otro nombre ficticio' WHERE id=1").run()
    const b=new TextEncoder().encode('%PDF-1.7 Estudio original ficticio'),hash=await sha256(b)
    t.objetos.set('estudios/original-ficticio',b)
    t.db.prepare('INSERT INTO archivos(id,paciente_id,consulta_id,nombre,clave,mime,tamano,sha256) VALUES (90001,1,99001,?,?,?,?,?)').run('Estudio histórico','estudios/original-ficticio','application/pdf',b.length,hash)
    t.db.prepare("UPDATE archivos SET anulado_en='2026-01-01T00:00:00Z',anulado_motivo='Error ficticio' WHERE id=90001").run()
    const res=await t.navegador.pedir('/pacientes/1/exportar',{form:{}})
    expect(res.status).toBe(200)
    const archivos=abrirZip(new Uint8Array(await res.arrayBuffer())),historia=JSON.parse(new TextDecoder().decode(archivos.get('historia.json')))
    expect(historia.consultas[0].foto).toBe(foto)
    expect(historia.paciente.nombre).toBe('Otro nombre ficticio')
    expect(historia.aclaraciones[0].texto).toBe('Aclaración ficticia posterior')
    expect(historia.mediciones[0].valor).toBe('70')
    expect(historia.antecedentes.length).toBeGreaterThan(0)
    expect(historia.pacientes_cambios.length).toBeGreaterThan(0)
    expect(archivos.get('estudios/90001_ANULADO_Estudio_historico.pdf')).toEqual(b)
    // También se puede emitir un documento nuevo luego de firmar la consulta.
    expect((await t.navegador.pedir('/documentos/emitir',{form:await formulario('certificado',70010,1,99001),headers:ajax})).status).toBe(200)
  })
  it('corta la exportación si falta un original y no entrega un ZIP válido incompleto',async()=>{
    const t=await preparado();await emitir(t);t.objetos.clear()
    const res=await t.navegador.pedir('/pacientes/1/exportar',{form:{}})
    await expect(res.arrayBuffer()).rejects.toThrow()
    expect(t.db.prepare("SELECT COUNT(*) n FROM auditoria WHERE evento='historia_exportada'").get()!.n).toBe(0)
  })
  it('el PDF conserva Unicode, embebe su fuente, pagina y tiene referencias válidas',()=>{
    const b=pdf(['Tensión cervical · ñ β',...Array.from({length:100},(_,i)=>`Renglón ${i}`)],fuente)
    const s=new TextDecoder().decode(b)
    expect(s).toContain('/Count 3');expect(s).toContain('/ToUnicode 5 0 R');expect(s).toContain('/FontFile2 8 0 R')
    expect(s).toContain('<00f1>');expect(s).toContain('<03b2>')
    const marcador=new TextEncoder().encode('xref\n'),offset=Number(s.match(/startxref\n(\d+)/)![1])
    expect(b.slice(offset,offset+marcador.length)).toEqual(marcador)
  })
})
