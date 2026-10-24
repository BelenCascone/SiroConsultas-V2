import {describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {DatabaseSync} from 'node:sqlite'
import {entorno,CLAVE_PRUEBA,ORIGEN,navegador} from './ayuda'
import {cuitValido,cbuValido,configurar,imagen} from '../../src/lib/comprobantes'
import {sha256} from '../../src/lib/documentos'

const fuente=readFileSync('public/fuentes/documentos-dejavu-sans.ttf'),logo=readFileSync('tests/fixtures/comprobante-logo.png')
const CUIT='20111111112',CBU='1234567489012345678902'
async function preparado(modulos='cobros,documentos,agenda') {
  const objetos=new Map<string,{bytes:Uint8Array;mime:string}>()
  const t=entorno({MODULOS:modulos,ASSETS:{fetch:async()=>new Response(fuente)} as unknown as Fetcher,ARCHIVOS:{
    put:async(k:string,b:Uint8Array,opts?:{httpMetadata?:{contentType:string}})=>{objetos.set(k,{bytes:new Uint8Array(b),mime:opts?.httpMetadata?.contentType??''});return {key:k}},
    get:async(k:string)=>objetos.has(k)?{arrayBuffer:async()=>objetos.get(k)!.bytes.slice().buffer,httpMetadata:{contentType:objetos.get(k)!.mime}}:null,
    delete:async(k:string)=>{objetos.delete(k)},
  } as unknown as R2Bucket})
  // D1 serializa sus transacciones; el adaptador SQLite comparte una conexión.
  const batch=t.env.DB.batch.bind(t.env.DB);let cola=Promise.resolve()
  t.env.DB.batch=((s:D1PreparedStatement[])=>{const r=cola.then(()=>batch(s));cola=r.then(()=>{},()=>{});return r}) as D1Database['batch']
  await t.navegador.pedir('/ingresar/prueba',{form:{clave:CLAVE_PRUEBA}})
  return {...t,objetos}
}
const campos={tipo:'interno',receptor:'paciente',pago:'1'}
const solicitar=(t:Awaited<ReturnType<typeof preparado>>,f:Record<string,string>={})=>t.navegador.pedir('/comprobantes/emitir',{form:{...campos,...f}})
const fila=(t:Awaited<ReturnType<typeof preparado>>,pago=1)=>t.db.prepare('SELECT * FROM comprobantes WHERE pago_id=?').get(pago)!
const ultimo=(t:Awaited<ReturnType<typeof preparado>>)=>t.db.prepare("SELECT ultimo FROM numeradores WHERE clave='comprobante_interno'").get()!.ultimo
function configurado(extra:Record<string,string>={}){return {cuit:CUIT,condicion_iva:'monotributo',domicilio_fiscal:'Calle Ficticia 123',punto_venta:'1',transferencia_alias:'alias.ficticio',transferencia_cbu:CBU,transferencia_titular:'Profesional ficticia',comprobante_color:'#24605F',comprobante_pie:'Gracias por tu visita ficticia',correo_contadora:'contadora@example.test',cobro_ausencia_horas:'24',...extra}}

describe('Migración impar de X4',()=>{
  it('conserva el perfil y los pagos anteriores y mantiene la protección de borrado',()=>{
    const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
    db.exec(readFileSync('migrations/0001_esquema.sql','utf8'));db.exec(readFileSync('migrations/0002_feriados_2026.sql','utf8'));db.exec(readFileSync('seed/seed.sql','utf8'))
    db.prepare("UPDATE profesional SET cuit=?,transferencia_cbu=?,comprobante_color='#24605F',transferencia_qr_clave='qr/ficticio',comprobante_logo_clave='logo/ficticio',arca_estado='produccion',correo_contadora='contadora@example.test' WHERE id=1").run(CUIT,CBU)
    const antes=db.prepare('SELECT * FROM profesional').get(),pagos=db.prepare('SELECT * FROM pagos').all()
    db.exec(readFileSync('migrations/0003_comprobante_foto.sql','utf8'))
    expect(db.prepare('SELECT * FROM profesional').get()).toEqual(antes)
    expect(db.prepare('SELECT * FROM pagos').all()).toEqual(pagos)
    expect(()=>db.exec("UPDATE profesional SET comprobante_color='#zzzzzz'")).toThrow()
    db.exec("UPDATE profesional SET comprobante_color='#1D5FB8'")
    expect(()=>db.exec('DELETE FROM profesional')).toThrow(/perfil/)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })
})

describe('Configuración de cobros',()=>{
  it('valida CUIT, CBU, datos fiscales, correo y límites sin aceptar cambios de ARCA',async()=>{
    expect(cuitValido(CUIT)).toBe(true);expect(cbuValido(CBU)).toBe(true)
    expect(cuitValido('00000000000')).toBe(false);expect(cbuValido('0000000000000000000000')).toBe(false)
    const t=await preparado(),r=await t.navegador.pedir('/configuracion/cobros',{form:configurado({arca_estado:'produccion',cobro_ausencia_activo:'1'})})
    expect(r.status,await r.clone().text()).toBe(303)
    expect(t.db.prepare('SELECT cuit,transferencia_cbu,arca_estado,cobro_ausencia_activo FROM profesional').get()).toEqual({cuit:CUIT,transferencia_cbu:CBU,arca_estado:'sin_configurar',cobro_ausencia_activo:1})
    for(const cambio of [{cuit:'20111111111'},{transferencia_cbu:CBU.slice(0,-1)+'1'},{correo_contadora:'no-es-correo'},{punto_venta:'0'},{cobro_ausencia_horas:'169'},{condicion_iva:'inventada'},{comprobante_color:'#abcdef'},{transferencia_alias:'a'}] as Record<string,string>[]) {
      expect((await t.navegador.pedir('/configuracion/cobros',{form:configurado(cambio)})).status).toBe(422)
      expect(t.db.prepare('SELECT cuit FROM profesional').get()!.cuit).toBe(CUIT)
    }
    const f=new FormData();f.set('cobro_ausencia_horas','24');expect(configurar(f).cobro_ausencia_activo).toBe(0)
    expect(t.db.prepare('SELECT COUNT(*) n FROM pagos').get()!.n).toBe(1)
  })
  it('carga logo y QR válidos, permite quitarlos y conserva los originales anteriores',async()=>{
    const t=await preparado(),f=new FormData()
    for(const[k,v]of Object.entries(configurado()))f.set(k,v)
    f.set('logo',new File([logo],'logo.png',{type:'image/png'}));f.set('qr',new File([logo],'qr.png',{type:'image/png'}))
    expect((await t.navegador.pedir('/configuracion/cobros',{method:'POST',body:f,headers:{Origin:ORIGEN}})).status).toBe(303)
    const antes=t.db.prepare('SELECT comprobante_logo_clave,transferencia_qr_clave FROM profesional').get()!
    expect(t.objetos.size).toBe(2)
    expect((await t.navegador.pedir('/configuracion/cobros/imagen/logo')).headers.get('content-type')).toBe('image/png')
    expect((await t.navegador.pedir('/configuracion/cobros/imagen/qr')).status).toBe(200)
    await t.navegador.pedir('/configuracion/cobros',{form:configurado({quitar_logo:'1',quitar_qr:'1'})})
    expect(t.db.prepare('SELECT comprobante_logo_clave,transferencia_qr_clave FROM profesional').get()).toEqual({comprobante_logo_clave:null,transferencia_qr_clave:null})
    expect(t.objetos.has(String(antes.comprobante_logo_clave))).toBe(true)
  })
  it('rechaza imágenes falsas, datos comprimidos corruptos y fotos demasiado grandes',async()=>{
    const t=await preparado(),f=new FormData();f.set('logo',new File(['<svg onload="alert(1)"/>'],'logo.png',{type:'image/png'}))
    expect((await t.navegador.pedir('/configuracion/cobros',{method:'POST',body:f,headers:{Origin:ORIGEN}})).status).toBe(422)
    await expect(imagen(new Uint8Array([255,216,255]))).rejects.toThrow()
    const roto=new Uint8Array(logo);roto[roto.length-5]^=1;await expect(imagen(roto)).rejects.toThrow()
    await expect(imagen(new Uint8Array(2*1024*1024+1))).rejects.toThrow()
    expect(t.objetos.size).toBe(0)
  })
  it('acepta un JPEG real y conserva su codificación para incrustarlo en el PDF',async()=>{
    const b=new Uint8Array(readFileSync('tests/fixtures/comprobante-logo.jpg')),im=await imagen(b)
    expect([im.ancho,im.alto,im.canales]).toEqual([2,1,3]);expect(im.filtro).toBe('DCTDecode')
    expect(Buffer.from(im.datos).equals(Buffer.from(b))).toBe(true)
  })
  it('decodifica PNG transparente y prepara RGB sobre blanco para el PDF',async()=>{
    const im=await imagen(logo)
    expect([im.ancho,im.alto,im.canales]).toEqual([2,1,3])
    expect([...inflateSync(im.datos)]).toEqual([36,96,95,255,255,255])
  })
})

describe('Emisión y conservación del comprobante',()=>{
  it('abrir o elegir Ahora no no consume número ni crea un comprobante',async()=>{
    const t=await preparado(),r=await t.navegador.pedir('/comprobantes/nuevo?pago=1'),h=await r.text()
    expect(r.status).toBe(200);expect(h).toContain('Factura C · llega en la etapa 4');expect(h).toContain('Ahora no');expect(ultimo(t)).toBe(0)
    expect(t.db.prepare('SELECT COUNT(*) n FROM comprobantes').get()!.n).toBe(0)
  })
  it('emite por el importe del pago, con foto inmutable y PDF original con huella',async()=>{
    const t=await preparado();expect((await solicitar(t)).status).toBe(303)
    const c=fila(t),obj=t.objetos.get(String(c.pdf_clave))!
    expect(c.importe).toBe(1000000);expect(c.numero).toBe(1);expect(c.receptor_nombre).toBe('Ana Gómez');expect(ultimo(t)).toBe(1)
    expect(c.pdf_sha256).toBe(await sha256(obj.bytes));expect(Buffer.from(obj.bytes).subarray(0,8).toString()).toBe('%PDF-1.7')
    const foto=JSON.parse(String(c.foto));expect(foto.profesional.nombre).toBe('Julia Paredes');expect(foto.profesional).not.toHaveProperty('transferencia_cbu');expect(foto).not.toHaveProperty('antecedentes')
    expect(()=>t.db.prepare("UPDATE comprobantes SET foto='{}' WHERE id=?").run(c.id)).toThrow(/foto/)
    t.db.prepare("UPDATE profesional SET nombre='Otra Profesional',comprobante_pie='Otro pie' WHERE id=1").run()
    t.db.prepare("UPDATE pacientes SET nombre='Otro Nombre' WHERE id=2").run()
    const h=await(await t.navegador.pedir(`/comprobantes/${c.id}`)).text()
    expect(h).toContain('Julia Paredes');expect(h).toContain('Ana Gómez')
    const r=await t.navegador.pedir(`/comprobantes/${c.id}/pdf`)
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect(Buffer.from(await r.arrayBuffer()).equals(Buffer.from(obj.bytes))).toBe(true)
  })
  it('volver a emitir el mismo pago devuelve el anterior y no consume otro número',async()=>{
    const t=await preparado(),r=await solicitar(t),id=fila(t).id
    expect((await solicitar(t,{receptor:'otra',receptor_nombre:'Otra persona',receptor_doc_tipo:'dni',receptor_doc:'99999999'})).headers.get('location')).toBe(r.headers.get('location'))
    expect((await t.navegador.pedir('/comprobantes/nuevo?pago=1')).headers.get('location')).toBe(`/comprobantes/${id}`)
    expect(ultimo(t)).toBe(1);expect(t.objetos.size).toBe(1)
  })
  it('dos emisiones simultáneas del mismo pago no duplican ni dejan PDFs huérfanos',async()=>{
    const t=await preparado(),rs=await Promise.all([solicitar(t),solicitar(t)])
    expect(rs.map(r=>r.status)).toEqual([303,303]);expect(rs[0].headers.get('location')).toBe(rs[1].headers.get('location'))
    expect(ultimo(t)).toBe(1);expect(t.objetos.size).toBe(1)
  })
  it('pagos distintos obtienen números distintos y correlativos aunque compitan',async()=>{
    const t=await preparado();t.db.prepare("INSERT INTO pagos(id,cobro_id,importe,medio,fecha) VALUES (2,1,100000,'transferencia','2026-01-01')").run()
    const rs=await Promise.all([solicitar(t),solicitar(t,{pago:'2'})])
    expect(rs.map(r=>r.status)).toEqual([303,303]);expect(ultimo(t)).toBe(2)
    expect(t.db.prepare('SELECT numero FROM comprobantes ORDER BY numero').all()).toEqual([{numero:1},{numero:2}]);expect(t.objetos.size).toBe(2)
  })
  it('permite otra persona con DNI o CUIT válido y rechaza un receptor incompleto',async()=>{
    const t=await preparado()
    for(const f of [{receptor_nombre:''},{receptor_doc:'123'},{receptor_doc_tipo:'cuit',receptor_doc:'20111111111'}])expect((await solicitar(t,{receptor:'otra',receptor_nombre:'Persona Ficticia',receptor_doc_tipo:'dni',receptor_doc:'99888777',...f})).status).toBe(422)
    expect(ultimo(t)).toBe(0)
    expect((await solicitar(t,{receptor:'otra',receptor_nombre:'Persona Ficticia',receptor_doc_tipo:'cuit',receptor_doc:CUIT})).status).toBe(303)
    expect(fila(t)).toMatchObject({receptor_nombre:'Persona Ficticia',receptor_doc_tipo:'cuit',receptor_doc:CUIT})
  })
  it('rechaza factura C, ausencia de perfil y pagos inexistentes o anulados',async()=>{
    const t=await preparado()
    expect((await solicitar(t,{tipo:'factura_c'})).status).toBe(422)
    expect((await solicitar(t,{pago:'9999'})).status).toBe(404)
    t.db.prepare('UPDATE profesional SET matricula=NULL WHERE id=1').run();expect((await solicitar(t)).status).toBe(409)
    t.db.prepare("UPDATE profesional SET matricula='MP 00000' WHERE id=1").run()
    t.db.prepare("UPDATE pagos SET anulado_en='2026-01-01T00:00:00Z',anulado_motivo='Ficticio' WHERE id=1").run();expect((await solicitar(t)).status).toBe(409)
    expect(ultimo(t)).toBe(0);expect(t.objetos.size).toBe(0)
  })
  it('si el registro falla revierte la numeración y retira el PDF no vinculado',async()=>{
    const t=await preparado(),silencio=vi.spyOn(console,'error').mockImplementation(()=>{})
    t.db.exec("CREATE TRIGGER falla_x4 BEFORE INSERT ON comprobantes BEGIN SELECT RAISE(ABORT,'fallo ficticio'); END")
    try {expect((await solicitar(t)).status).toBe(500)}finally{silencio.mockRestore()}
    expect(ultimo(t)).toBe(0);expect(t.objetos.size).toBe(0);expect(t.db.prepare('SELECT COUNT(*) n FROM comprobantes').get()!.n).toBe(0)
  })
  it('si D1 confirma pero se pierde la respuesta, conserva el PDF y devuelve el comprobante existente',async()=>{
    const t=await preparado(),batch=t.env.DB.batch.bind(t.env.DB)
    t.env.DB.batch=(async(s:D1PreparedStatement[])=>{await batch(s);throw new Error('Respuesta ficticia perdida')}) as D1Database['batch']
    expect((await solicitar(t)).status).toBe(303)
    expect(ultimo(t)).toBe(1);expect(t.objetos.size).toBe(1)
    const c=fila(t);expect((await t.navegador.pedir(`/comprobantes/${c.id}/pdf`)).status).toBe(200)
  })
  it('si R2 falla no registra ni numera un comprobante',async()=>{
    const t=await preparado(),silencio=vi.spyOn(console,'error').mockImplementation(()=>{})
    t.env.ARCHIVOS.put=vi.fn(async()=>{throw new Error('Fallo ficticio de R2')})
    try{expect((await solicitar(t)).status).toBe(500)}finally{silencio.mockRestore()}
    expect(ultimo(t)).toBe(0);expect(t.objetos.size).toBe(0)
  })
  it('conserva el PDF después de anular y el formulario delega la anulación a P4',async()=>{
    const t=await preparado();await solicitar(t);const c=fila(t),antes=t.objetos.get(String(c.pdf_clave))!.bytes
    const h=await(await t.navegador.pedir(`/comprobantes/${c.id}`)).text()
    expect(h).toContain('action="/pagos/1/anular"');expect(h).toContain('name="motivo"')
    expect(()=>t.db.prepare("UPDATE comprobantes SET numero=999,estado='anulado',anulado_en='2026-01-01T00:00:00Z',anulado_motivo='Ficticio' WHERE id=?").run(c.id)).toThrow(/número/)
    t.db.exec(`BEGIN; UPDATE comprobantes SET estado='anulado',anulado_en='2026-01-01T00:00:00Z',anulado_motivo='Ficticio' WHERE id=${c.id}; UPDATE pagos SET anulado_en='2026-01-01T00:00:00Z',anulado_motivo='Ficticio' WHERE id=1; COMMIT`)
    expect(await(await t.navegador.pedir(`/comprobantes/${c.id}`)).text()).toContain('El PDF original se conserva')
    expect(Buffer.from(await(await t.navegador.pedir(`/comprobantes/${c.id}/pdf`)).arrayBuffer()).equals(Buffer.from(antes))).toBe(true)
    expect((await solicitar(t)).status).toBe(303);expect(ultimo(t)).toBe(1)
  })
  it('comprueba la huella al descargar y nunca reconstruye un PDF faltante con el perfil actual',async()=>{
    const t=await preparado();await solicitar(t);const c=fila(t)
    t.objetos.get(String(c.pdf_clave))!.bytes=new Uint8Array([1,2,3])
    expect((await t.navegador.pedir(`/comprobantes/${c.id}/pdf`)).status).toBe(409)
    t.objetos.clear();expect((await t.navegador.pedir(`/comprobantes/${c.id}/pdf`)).status).toBe(404)
    expect(ultimo(t)).toBe(1)
  })
  it('el PDF lleva color y el logo incrustado; cambiarlo no modifica la vista histórica',async()=>{
    const t=await preparado();t.objetos.set('logo/ficticio',{bytes:new Uint8Array(logo),mime:'image/png'})
    t.db.prepare("UPDATE profesional SET comprobante_logo_clave='logo/ficticio',comprobante_color='#1D5FB8' WHERE id=1").run()
    expect((await solicitar(t)).status).toBe(303)
    const c=fila(t),s=Buffer.from(t.objetos.get(String(c.pdf_clave))!.bytes).toString('latin1')
    expect(s).toContain('/Subtype /Image');expect(s).toContain('/Logo 9 0 R');expect(s).toContain('0.1137 0.3725 0.7216 RG')
    t.db.prepare("UPDATE profesional SET comprobante_logo_clave=NULL WHERE id=1").run()
    expect((await t.navegador.pedir(`/comprobantes/${c.id}/logo`)).status).toBe(200)
  })
})

describe('Acceso y módulos',()=>{
  it('exige sesión, mismo origen y módulo de cobros en todas las entradas',async()=>{
    const t=await preparado(),sin=navegador(t.env)
    expect((await sin.pedir('/comprobantes/nuevo?pago=1')).status).toBe(302)
    expect((await sin.pedir('/comprobantes/emitir',{form:campos})).status).toBe(401)
    expect((await t.navegador.pedir('/comprobantes/emitir',{form:campos,headers:{Origin:'https://otro.test'}})).status).toBe(403)
    const apagado=await preparado('agenda')
    for(const u of ['/comprobantes/nuevo?pago=1','/comprobantes/1','/configuracion/cobros','/configuracion/cobros/imagen/qr'])expect((await apagado.navegador.pedir(u)).status).toBe(404)
    expect(await(await apagado.navegador.pedir('/configuracion/perfil')).text()).not.toContain('href="/configuracion/cobros"')
  })
})
