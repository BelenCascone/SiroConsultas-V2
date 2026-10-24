import {describe,it,expect,vi} from 'vitest'
import {entorno as entornoBase,CLAVE_PRUEBA} from './ayuda'
import {desplazarMes,enlace,finMes,leerEstadisticas,leerFiltros,porcentaje} from '../../src/lib/estadisticas'
// D1 devuelve filas también para SELECT dentro de batch; el adaptador general solo usa run.
function entorno(...args:Parameters<typeof entornoBase>) {
  const t=entornoBase(...args)
  // La historia de la semilla queda en un pasado fijo, fuera del período 2030 de estas pruebas.
  t.db.exec("UPDATE config SET valor='1' WHERE clave='restauracion'; UPDATE turnos SET fecha='2000-01-01'; UPDATE cobros SET fecha='2000-01-01'; UPDATE pagos SET fecha='2000-01-01'; UPDATE config SET valor='0' WHERE clave='restauracion'")
  t.env.DB.batch=(async(q:D1PreparedStatement[])=>{
    t.db.exec('BEGIN')
    try {const r=[];for(const st of q)r.push(await st.all());t.db.exec('COMMIT');return r}catch(e){t.db.exec('ROLLBACK');throw e}
  }) as D1Database['batch']
  return t
}
const HOY='2030-01-20' 
const filtros=(q:Record<string,string>={})=>leerFiltros(q,HOY)
type T=ReturnType<typeof entorno>
function atender(t:T,paciente:number,fecha:string,hora='09:00',co=1,cobertura='particular') {
  const id=Number(t.db.prepare('INSERT INTO turnos(paciente_id,consultorio_id,fecha,hora,duracion_min,prestacion_id,cobertura,obra_social_id) VALUES (?,?,?,?,30,2,?,?)').run(paciente,co,fecha,hora,cobertura,cobertura==='obra_social'?1:null).lastInsertRowid)
  t.db.prepare("UPDATE turnos SET estado='atendido',cerrado_en=? WHERE id=?").run(fecha+'T15:00:00Z',id)
  return id
}
function firmar(t:T,paciente:number,en:string,turno:number|null=null,co:number|null=null,cobertura:string|null='particular') {
  const id=Number(t.db.prepare("INSERT INTO consultas(paciente_id,tipo,turno_id,consultorio_id) VALUES (?,'control',?,?)").run(paciente,turno,co).lastInsertRowid)
  t.db.prepare("UPDATE consultas SET estado='finalizada',finalizada_en=?,foto=?,motivo='DATO CLINICO PRIVADO' WHERE id=?").run(en,JSON.stringify({paciente:{cobertura,obra_social_id:cobertura==='obra_social'?1:null}}),id)
  return id
}
function cobrar(t:T,importe:number,pagado:number,fecha='2030-01-05',co:number|null=1,os=false,medio='efectivo',prestacion:number|null=2) {
  const cobro=Number(t.db.prepare('INSERT INTO cobros(paciente_id,consultorio_id,prestacion_id,concepto,importe,fecha,cobertura,obra_social_id) VALUES (2,?,?,\'Concepto ficticio\',?,?,?,?)').run(co,prestacion,importe,fecha,os?'obra_social':'particular',os?1:null).lastInsertRowid)
  const pago=pagado?Number(t.db.prepare('INSERT INTO pagos(cobro_id,importe,medio,fecha) VALUES (?,?,?,?)').run(cobro,pagado,medio,fecha).lastInsertRowid):null
  return {cobro,pago}
}
const leer=(t:T,f=filtros(),dinero=true)=>leerEstadisticas(t.env.DB,f,dinero)

describe('Períodos y navegación',()=>{
  it('usa meses completos, último trimestre cerrado y comparación anterior equivalente',()=>{
    expect(filtros()).toMatchObject({desde:'2030-01-01',hasta:'2030-01-31',anteriorDesde:'2029-12-01',anteriorHasta:'2029-12-31'})
    expect(filtros({periodo:'anterior'})).toMatchObject({desde:'2029-12-01',hasta:'2029-12-31',anteriorDesde:'2029-11-01',anteriorHasta:'2029-11-30'})
    expect(filtros({periodo:'trimestre'})).toMatchObject({desde:'2029-10-01',hasta:'2029-12-31',anteriorDesde:'2029-07-01',anteriorHasta:'2029-09-30'})
    expect(leerFiltros({periodo:'fechas',desde:'2028-02-28',hasta:'2028-02-29'},HOY)).toMatchObject({anteriorDesde:'2028-02-26',anteriorHasta:'2028-02-27'})
    expect(finMes('2028-02-01')).toBe('2028-02-29');expect(desplazarMes('2030-01-31',-1)).toBe('2029-12-01')
  })
  it('rechaza rangos imposibles, datos inyectados e identificadores inválidos',()=>{
    const casos:Record<string,string>[]=[{periodo:'inventado'},{periodo:'fechas',desde:'2030-99-99',hasta:'2030-01-01'},{periodo:'fechas',desde:'2030-01-10',hasta:'2030-01-01'},{periodo:'fechas',desde:'0001-01-01',hasta:'9999-12-31'},{consultorio:'1 OR 1=1'},{consultorio:'-1'},{consultorio:'1.5'},{mes:'2030-13'},{periodo:'fechas',desde:'<script>',hasta:HOY}]
    for(const c of casos)expect(()=>filtros(c)).toThrow()
  })
  it('los enlaces conservan fechas y consultorio; un mes que quedó fuera de la ventana no rompe un favorito',()=>{
    const f=filtros({periodo:'fechas',desde:'2029-12-10',hasta:'2030-01-03',consultorio:'2',tabla:'1',mes:'2029-12'})
    const u=new URL(enlace(f,{mes:'2029-11'},'est-detalle'),'http://localhost')
    expect(u.searchParams.get('desde')).toBe('2029-12-10');expect(u.searchParams.get('consultorio')).toBe('2');expect(u.hash).toBe('#est-detalle')
    expect(filtros({mes:'2000-01'}).mes).toBe('2030-01');expect(porcentaje(0,0)).toBe(0)
  })
})

describe('Atenciones y agrupaciones',()=>{
  it('cuenta un turno con consulta una sola vez y excluye borradores, descartadas y turnos abiertos',async()=>{
    const t=entorno(),tid=atender(t,3,'2030-01-03')
    firmar(t,3,'2030-01-03T14:00:00Z',tid,1)
    firmar(t,4,'2030-01-04T14:00:00Z',null,2)
    t.db.prepare("INSERT INTO consultas(paciente_id,tipo) VALUES (3,'primera')").run()
    t.db.prepare("INSERT INTO turnos(paciente_id,consultorio_id,fecha,hora,duracion_min) VALUES (3,1,'2030-01-06','09:00',30)").run()
    const d=await leer(t,filtros(),false)
    expect(d).toMatchObject({consultas:2,primera:2,vuelven:0,finanzas:null})
    expect(d.consultorios.map(g=>[g.nombre,g.n])).toEqual(expect.arrayContaining([['Centro',1],['Norte',1]]))
  })
  it('clasifica primera vez con toda la historia, antes de filtrar el período y el consultorio',async()=>{
    const t=entorno();atender(t,1,'2029-12-15','09:00',1);atender(t,1,'2030-01-15','09:00',2);atender(t,1,'2030-01-16','09:00',2)
    const d=await leer(t,filtros({consultorio:'2'}),false)
    expect(d).toMatchObject({consultas:2,primera:0,vuelven:2,anteriores:0})
    expect(d.meses.find(m=>m.mes==='2030-01')).toMatchObject({primera:0,vuelven:2,total:2})
    expect((await leer(t,filtros(),false)).anteriores).toBe(1)
  })
  it('ubica una consulta sin turno en Argentina y conserva la cobertura de su foto',async()=>{
    const t=entorno();firmar(t,2,'2030-02-01T02:59:59Z',null,null,'obra_social')
    const d=await leer(t,filtros(),false)
    expect(d.consultas).toBe(1);expect(d.coberturas).toEqual([{id:'os:1',nombre:'OSDE',n:1}])
    expect(d.consultorios).toEqual([{id:0,nombre:'Sin consultorio',n:1}])
    expect(d.modalidades).toEqual([{id:null,nombre:'Sin modalidad registrada',n:1}])
    expect((await leer(t,filtros({consultorio:'sin'}),false)).consultas).toBe(1)
    expect((await leer(t,filtros({periodo:'fechas',desde:'2030-02-01',hasta:'2030-02-01'}),false)).consultas).toBe(0)
  })
  it('separa particular, obra social y cobertura desconocida, incluso si la ficha cambia',async()=>{
    const t=entorno();atender(t,1,'2030-01-01');atender(t,2,'2030-01-02','09:00',1,'obra_social')
    firmar(t,3,'2030-01-03T14:00:00Z',null,null,null)
    const d=await leer(t,filtros(),false)
    expect(d.coberturas.map(g=>g.n).reduce((n,v)=>n+v,0)).toBe(3)
    expect(d.coberturas.find(g=>g.nombre==='Particular')?.n).toBe(1)
    expect(d.coberturas.find(g=>g.nombre==='Sin cobertura registrada')?.n).toBe(1)
    t.db.prepare("UPDATE pacientes SET cobertura='particular',obra_social_id=NULL WHERE id=2").run()
    expect((await leer(t,filtros(),false)).coberturas.find(g=>g.nombre==='OSDE')?.n).toBe(1)
  })
  it('clasifica ausencias y las tres procedencias de cancelación por fecha del turno',async()=>{
    const t=entorno()
    for(const quien of ['ausente','paciente','profesional','sistema']) {
      const id=Number(t.db.prepare("INSERT INTO turnos(paciente_id,consultorio_id,fecha,hora,duracion_min) VALUES (1,2,'2030-01-10','09:00',30)").run().lastInsertRowid)
      if(quien==='ausente')t.db.prepare("UPDATE turnos SET estado='ausente',cerrado_en='2030-01-10T15:00:00Z' WHERE id=?").run(id)
      else t.db.prepare("UPDATE turnos SET estado='cancelado',cancelado_por=?,cerrado_en='2030-01-10T15:00:00Z' WHERE id=?").run(quien,id)
    }
    const d=await leer(t,filtros({consultorio:'2'}),false)
    expect(d).toMatchObject({ausencias:1,canceladosPaciente:1,canceladosProfesional:1,canceladosSistema:1,consultas:0})
    expect((await leer(t,filtros({consultorio:'1'}),false)).ausencias).toBe(0)
  })
  it('conserva atenciones históricas de consultorios inactivos y fichas archivadas',async()=>{
    const t=entorno();atender(t,1,'2030-01-04')
    t.db.prepare('UPDATE consultorios SET activo=0 WHERE id=1').run()
    t.db.prepare("UPDATE pacientes SET baja_en='2030-01-05T00:00:00Z',baja_motivo='otro' WHERE id=1").run()
    expect((await leer(t,filtros({consultorio:'1'}),false)).consultas).toBe(1)
  })
  it('completa seis meses con cero sin dividir por cero ni fabricar actividad',async()=>{
    const d=await leer(entorno(),filtros(),false)
    expect(d.meses.map(m=>m.mes)).toEqual(['2029-08','2029-09','2029-10','2029-11','2029-12','2030-01'])
    expect(d.meses.every(m=>m.total===0&&m.primera===0&&m.vuelven===0)).toBe(true)
    expect(d.consultas).toBe(0)
  })
})

describe('Estadísticas de cobros',()=>{
  it('usa pagos del período, sin multiplicarlos al unir comprobantes y con importes exactos en centavos',async()=>{
    const t=entorno(),a=cobrar(t,1001,101),b=cobrar(t,1000,200,'2030-01-06',2,true,'transferencia')
    t.db.prepare("INSERT INTO comprobantes(pago_id,tipo,numero,receptor_nombre,receptor_doc_tipo,receptor_doc,importe,fecha,estado) VALUES (?,'interno',1,'Persona Ficticia','dni','99888777',101,'2030-01-05','emitido')").run(a.pago)
    const d=(await leer(t)).finanzas!
    expect(d).toMatchObject({cobrado:301,pagos:2,particulares:101,copagos:200,interno:101,sinComprobante:200,facturado:0,ticket:151})
    expect(d.medios.map(g=>g.n).reduce((a,b)=>a+b,0)).toBe(301)
    expect(d.prestaciones.reduce((n,p)=>n+p.cobrado,0)).toBe(301)
    expect(d.prestaciones[0]).toMatchObject({consultas:0,cobrado:301,pagos:2,promedio:151})
    expect((await leer(t,filtros({consultorio:'2'}))).finanzas).toMatchObject({cobrado:200,particulares:0,copagos:200})
    expect(a.pago).not.toBe(b.pago)
  })
  it('excluye pagos y comprobantes anulados; no mezcla fecha del cobro con fecha del pago',async()=>{
    const t=entorno(),a=cobrar(t,500,200),b=cobrar(t,700,300,'2029-12-10')
    t.db.prepare("INSERT INTO comprobantes(pago_id,tipo,numero,receptor_nombre,receptor_doc_tipo,receptor_doc,importe,fecha,estado) VALUES (?,'interno',1,'Persona Ficticia','dni','99888777',200,'2030-01-05','emitido')").run(a.pago)
    t.db.prepare("UPDATE comprobantes SET estado='anulado',anulado_en='2030-01-06T00:00:00Z',anulado_motivo='Ficticio' WHERE pago_id=?").run(a.pago)
    t.db.prepare("UPDATE pagos SET anulado_en='2030-01-06T00:00:00Z',anulado_motivo='Ficticio' WHERE id=?").run(a.pago)
    t.db.prepare("INSERT INTO pagos(cobro_id,importe,medio,fecha) VALUES (?,100,'tarjeta','2030-01-07')").run(b.cobro)
    expect((await leer(t)).finanzas).toMatchObject({cobrado:100,pagos:1,ticket:100,sinComprobante:100,interno:0})
  })
  it('te deben muestra el saldo actual y los atendidos sin cobro, también fuera del período',async()=>{
    const t=entorno(),base=(await leer(t)).finanzas!.deben
    cobrar(t,1000,100,'2029-01-01')
    t.db.prepare('UPDATE prestaciones SET importe=2000 WHERE id=2').run();const tid=atender(t,1,'2029-02-01')
    expect((await leer(t)).finanzas!.deben).toBe(base+900+2000)
    t.db.prepare("INSERT INTO cobros(paciente_id,turno_id,consultorio_id,concepto,importe,fecha) VALUES (1,?,1,'Sin cargo',0,'2029-02-01')").run(tid)
    expect((await leer(t)).finanzas!.deben).toBe(base+900)
    expect((await leer(t,filtros({consultorio:'2'}))).finanzas!.deben).toBe(0)
  })
  it('perdonar un cargo no borra el dinero de un pago que sigue vigente',async()=>{
    const t=entorno()
    const c=Number(t.db.prepare("INSERT INTO cobros(paciente_id,consultorio_id,concepto,importe,fecha,origen) VALUES (2,2,'Ausencia ficticia',1000,'2030-01-05','ausencia')").run().lastInsertRowid)
    t.db.prepare("INSERT INTO pagos(cobro_id,importe,medio,fecha) VALUES (?,200,'efectivo','2030-01-05')").run(c)
    t.db.prepare("UPDATE cobros SET perdonado_en='2030-01-06T00:00:00Z',perdonado_motivo='Ficticio' WHERE id=?").run(c)
    const f=(await leer(t,filtros({consultorio:'2'}))).finanzas!
    expect(f).toMatchObject({cobrado:200,particulares:200,deben:0,pagos:1})
    expect(f.prestaciones[0].cobrado).toBe(200)
  })
  it('no cobra dos veces facturas con nota de crédito ni las considera comprobantes internos',async()=>{
    const t=entorno(),a=cobrar(t,400,400)
    const id=Number(t.db.prepare("INSERT INTO comprobantes(pago_id,tipo,punto_venta,numero,receptor_nombre,receptor_doc_tipo,receptor_doc,importe,fecha,estado,cae,cae_vence) VALUES (?,'factura_c',1,1,'Persona Ficticia','dni','99888777',400,'2030-01-05','emitido','12345678901234','2030-01-15')").run(a.pago).lastInsertRowid)
    expect((await leer(t)).finanzas).toMatchObject({facturado:400,interno:0,cobrado:400,pagos:1})
    t.db.prepare("INSERT INTO comprobantes(pago_id,tipo,punto_venta,numero,asociado_id,receptor_nombre,receptor_doc_tipo,receptor_doc,importe,fecha,estado,cae,cae_vence) VALUES (?,'nota_credito_c',1,1,?,'Persona Ficticia','dni','99888777',400,'2030-01-06','emitido','12345678901235','2030-01-16')").run(a.pago,id)
    expect((await leer(t)).finanzas).toMatchObject({facturado:0,interno:0,sinComprobante:400,cobrado:400,pagos:1})
  })
  it('una factura pendiente no suma como emitida hasta obtener su CAE',async()=>{
    const t=entorno(),a=cobrar(t,500,500)
    const id=Number(t.db.prepare("INSERT INTO comprobantes(pago_id,tipo,punto_venta,receptor_nombre,receptor_doc_tipo,receptor_doc,importe,fecha,estado) VALUES (?,'factura_c',1,'Persona Ficticia','dni','99888777',500,'2030-01-05','pendiente')").run(a.pago).lastInsertRowid)
    expect((await leer(t)).finanzas).toMatchObject({cobrado:500,facturado:0,sinComprobante:500})
    t.db.prepare("UPDATE comprobantes SET estado='emitido',numero=1,cae='12345678901234',cae_vence='2030-01-15' WHERE id=?").run(id)
    expect((await leer(t)).finanzas).toMatchObject({cobrado:500,facturado:500,sinComprobante:0})
  })
  it('no lee datos financieros cuando el módulo está apagado',async()=>{
    const t=entorno(),preparar=t.env.DB.prepare.bind(t.env.DB)
    const spy=vi.spyOn(t.env.DB,'prepare').mockImplementation(sql=>{if(/\b(pagos|cobros|comprobantes)\b/i.test(sql))throw new Error('No debe leer finanzas');return preparar(sql)})
    expect((await leer(t,filtros(),false)).finanzas).toBeNull();spy.mockRestore()
  })
})

describe('Pantalla real, acceso y SVG',()=>{
  async function conSesion(modulos='estadisticas,cobros,agenda') {const t=entorno({MODULOS:modulos});await t.navegador.pedir('/ingresar/prueba',{form:{clave:CLAVE_PRUEBA}});return t}
  it('exige sesión y módulo habilitado; las estadísticas son de solo lectura',async()=>{
    const t=entorno();expect((await t.navegador.pedir('/estadisticas')).status).toBe(302)
    const apagado=await conSesion('agenda');expect((await apagado.navegador.pedir('/estadisticas')).status).toBe(404)
    const activo=await conSesion();expect((await activo.navegador.pedir('/estadisticas',{form:{}})).status).toBe(404)
  })
  it('muestra errores de filtro en español sin romper la página',async()=>{
    const t=await conSesion()
    for(const q of ['periodo=x','periodo=fechas&desde=2030-99-99&hasta=2030-01-01','consultorio=99999','consultorio=1%20OR%201=1']) {
      const r=await t.navegador.pedir('/estadisticas?'+q);expect(r.status).toBe(400);expect(await r.text()).toContain('Revisá los filtros')
    }
  })
  it('arma SVG accesible en el servidor y tabla equivalente, sin notas clínicas, estilos ni scripts inline',async()=>{
    const t=await conSesion();firmar(t,1,new Date().toISOString(),null,1)
    const r=await t.navegador.pedir('/estadisticas'),h=await r.text()
    expect(r.status,h).toBe(200);expect(h).toContain('<svg');expect(h).toContain('est-grafico-titulo');expect(h).toContain('Ver como tabla')
    expect(h).not.toContain('style=');expect(h).not.toMatch(/<script(?![^>]*\bsrc=)/);expect(h).not.toContain('DATO CLINICO PRIVADO')
    expect(h).toContain('/contadora?periodo=fechas&amp;desde=');expect(h).toContain('data-modulo="cobros"')
    const tabla=await(await t.navegador.pedir('/estadisticas?tabla=1')).text();expect(tabla).toContain('<table');expect(tabla).toContain('Ver gráfico');expect(tabla).toContain('Detalle del mes')
    expect((await t.navegador.pedir('/contadora')).status).toBe(200)
  })
  it('oculta los importes y el enlace a la contadora si cobros está apagado',async()=>{
    const t=await conSesion('estadisticas'),h=await(await t.navegador.pedir('/estadisticas')).text()
    expect(h).toContain('Pacientes y consultas');expect(h).not.toContain('Enviar a la contadora');expect(h).not.toContain('Ticket promedio');expect(h).not.toContain('Particulares')
  })
})
