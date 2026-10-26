import {describe,it,expect} from 'vitest'
import {randomBytes,createHash} from 'node:crypto'
import {readFile,writeFile,stat,mkdir,readdir,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readdirSync,readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {baseNueva,errorDe} from '../base/base'
import {cifrar,descifrar,claveDe,huella} from '../../scripts/respaldos/cifrado.ts'
import {crearCopia,simular,temporal,type Puerto} from '../../scripts/respaldos/copia.ts'
import {referencias,restaurarBase,type ObjetoSQL} from '../../scripts/respaldos/base.ts'
import {Nube,configuracion,ESQUEMA} from '../../scripts/respaldos/nube.ts'

const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex')
const conf={cuenta:'a'.repeat(32),base:'b'.repeat(8)+'-'+['bbbb','bbbb','bbbb','b'.repeat(12)].join('-'),archivos:'siro-ficticios',respaldos:'siro-respaldos',token:'token-ficticio'}
function escenario(){
  const db=baseNueva({conDatos:true}),objetos=new Map<string,Buffer>(),subidos:string[]=[]
  const estudio=Buffer.from('ESTUDIO FICTICIO · no son datos reales')
  db.prepare('INSERT INTO archivos(paciente_id,nombre,clave,mime,tamano,sha256) VALUES (1,?,?,?,?,?)').run('Estudio','estudios/../ficticio.pdf','application/pdf',estudio.length,hash(estudio))
  db.exec("UPDATE profesional SET foto_clave='perfil/foto.png',transferencia_qr_clave='perfil/qr.png',comprobante_logo_clave='perfil/logo.png'")
  objetos.set(conf.archivos+'/estudios/../ficticio.pdf',estudio)
  for(const s of ['foto','qr','logo'])objetos.set(conf.archivos+`/perfil/${s}.png`,Buffer.from('imagen ficticia '+s))
  // Los datos se generan con quote() de SQLite, como una exportación D1 de solo datos.
  const exportacion=()=>{
    let sql=''
    const tablas=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    for(const t of tablas){
      const nombre=String(t.name),columnas=db.prepare(`PRAGMA table_info("${nombre}")`).all().map(c=>'"'+c.name+'"')
      const valores=db.prepare(`SELECT ${columnas.map(c=>'quote('+c+')').join(',')} FROM "${nombre}"`).all()
      for(const r of valores)sql+=`INSERT INTO "${nombre}" VALUES (${Object.values(r).join(',')});\n`
    }
    sql+='DELETE FROM sqlite_sequence;\n'
    for(const s of db.prepare('SELECT name,seq FROM sqlite_sequence').all())sql+=`INSERT INTO sqlite_sequence VALUES ('${s.name}',${s.seq});\n`
    return sql
  }
  const n:Puerto={c:conf,
    async esquema(){return db.prepare(ESQUEMA).all() as unknown as ObjetoSQL[]},
    async exportar(destino){await writeFile(destino,exportacion(),{mode:0o600})},
    async bajar(bucket,clave,destino){const b=objetos.get(bucket+'/'+clave);if(!b)throw new Error('Objeto ausente');await writeFile(destino,b,{flag:'wx',mode:0o600});return 'image/png'},
    async subir(clave,origen){objetos.set(conf.respaldos+'/'+clave,await readFile(origen));subidos.push(clave)},
    async consulta(){return []},
  }
  return {n,db,objetos,subidos,exportacion}
}

describe('Cifrado autenticado y archivos privados',()=>{
  it('exige una clave independiente de 256 bits',()=>{
    expect(()=>claveDe(undefined)).toThrow();expect(()=>claveDe('una contraseña')).toThrow();expect(claveDe('ab'.repeat(32))).toHaveLength(32)
  })
  it('recupera bytes idénticos, usa IV distintos y rechaza clave equivocada, truncado y alteración',async()=>temporal(async d=>{
    const b=randomBytes(180_000),k=randomBytes(32);await writeFile(join(d,'original'),b)
    await cifrar(join(d,'original'),join(d,'uno'),k);await cifrar(join(d,'original'),join(d,'dos'),k)
    expect(await readFile(join(d,'uno'))).not.toEqual(await readFile(join(d,'dos')))
    await descifrar(join(d,'uno'),join(d,'vuelta'),k);expect(await readFile(join(d,'vuelta'))).toEqual(b)
    expect((await stat(join(d,'uno'))).mode&0o777).toBe(0o600)
    await expect(descifrar(join(d,'uno'),join(d,'original'),k)).rejects.toThrow()
    expect(await readFile(join(d,'original'))).toEqual(b)
    await expect(descifrar(join(d,'uno'),join(d,'incorrecto'),randomBytes(32))).rejects.toThrow('autenticar')
    await expect(access(join(d,'incorrecto'))).rejects.toThrow()
    const roto=await readFile(join(d,'uno'));roto[30]^=1;await writeFile(join(d,'roto'),roto)
    await expect(descifrar(join(d,'roto'),join(d,'salida'),k)).rejects.toThrow('autenticar')
    await writeFile(join(d,'corto'),roto.subarray(0,10));await expect(descifrar(join(d,'corto'),join(d,'salida'),k)).rejects.toThrow('truncado')
  }))
})

describe('Respaldo completo y simulacro aislado',()=>{
  it('restaura SQL, originales, claves, huellas, correlativos, vistas y triggers sin tocar el origen',async()=>{
    const {n,db,objetos,subidos}=escenario(),k=randomBytes(32)
    try{await temporal(async d=>{
      const antes=db.prepare('SELECT * FROM pacientes').all(),r=await crearCopia(n,k)
      expect(subidos.at(-1)).toBe(`v1/${r.id}/manifiesto.enc`)
      for(const b of objetos.entries())if(b[0].startsWith(conf.respaldos))expect(b[1].includes(Buffer.from('ESTUDIO FICTICIO'))).toBe(false)
      const informe=await simular(n,k,r.id,join(d,'simulacro'))
      expect(informe).toMatchObject({archivos:4,integridad:'ok',relaciones:'ok',huellas:'ok',restauracion:'0'})
      const base=new DatabaseSync(join(d,'simulacro/copia/base.sqlite'))
      try{
        expect(base.prepare('SELECT * FROM pacientes').all()).toEqual(antes)
        expect(base.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()).toEqual(db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all())
        expect(base.prepare('SELECT COUNT(*) n FROM v_cobros').get()).toEqual(db.prepare('SELECT COUNT(*) n FROM v_cobros').get())
        expect(errorDe(base,'DELETE FROM archivos')).toMatch(/borra/)
        expect(base.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get()).toEqual(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get())
      }finally{base.close()}
      expect(db.prepare('SELECT * FROM pacientes').all()).toEqual(antes)
      expect((await readdir(join(d,'simulacro/copia/archivos')))).toHaveLength(4)
      expect((await stat(join(d,'simulacro'))).mode&0o777).toBe(0o700)
      expect(r.sha256).toBe(hash(objetos.get(conf.respaldos+'/'+r.clave)!))
    })}finally{db.close()}
  })
  it('incluye PDFs clínicos, comprobantes y logos congelados aunque cambie el perfil',async()=>{
    const {n,db,objetos}=escenario(),k=randomBytes(32)
    try{
      const archivos=[['documentos/pedido.pdf',Buffer.from('pedido ficticio')],['comprobantes/uno.pdf',Buffer.from('comprobante ficticio')],['logos/anterior.png',Buffer.from('logo histórico ficticio')]] as const
      for(const [clave,bytes]of archivos)objetos.set(conf.archivos+'/'+clave,bytes)
      db.prepare("INSERT INTO documentos(paciente_id,tipo,datos,fecha,pdf_clave,pdf_sha256) VALUES (1,'pedido','{}','2030-01-01',?,?)").run(archivos[0][0],hash(archivos[0][1]))
      const foto=JSON.stringify({profesional:{comprobante_logo_clave:archivos[2][0]},logo_sha256:hash(archivos[2][1])})
      db.prepare("INSERT INTO comprobantes(pago_id,tipo,numero,receptor_nombre,receptor_doc_tipo,receptor_doc,importe,fecha,estado,pdf_clave,pdf_sha256,foto) VALUES (1,'interno',1,'Ficticio','dni','12345678',1000000,'2030-01-01','emitido',?,?,?)").run(archivos[1][0],hash(archivos[1][1]),foto)
      const r=await crearCopia(n,k),informe=await simular(n,k,r.id)
      expect(informe.archivos).toBe(7)
    }finally{db.close()}
  })
  it('no publica el manifiesto si falta un original o no coincide su huella',async()=>{
    for(const corrupto of [false,true]){
      const {n,db,objetos,subidos}=escenario()
      try{
        if(corrupto)objetos.set(conf.archivos+'/estudios/../ficticio.pdf',Buffer.from('distinto'));else objetos.delete(conf.archivos+'/estudios/../ficticio.pdf')
        await expect(crearCopia(n,randomBytes(32))).rejects.toThrow()
        expect(subidos.some(x=>x.endsWith('manifiesto.enc'))).toBe(false)
      }finally{db.close()}
    }
  })
  it('detecta cambios de esquema durante la exportación',async()=>{
    const {n,db,subidos}=escenario(),original=n.esquema;let veces=0
    n.esquema=async()=>{const e=await original();return ++veces===1?e:e.slice(1)}
    try{await expect(crearCopia(n,randomBytes(32))).rejects.toThrow('esquema cambió');expect(subidos).toHaveLength(0)}finally{db.close()}
  })
  it('rechaza piezas ausentes, corruptas y copias de otra instalación',async()=>{
    const {n,db,objetos}=escenario(),k=randomBytes(32)
    try{
      const r=await crearCopia(n,k),nombre=conf.respaldos+`/v1/${r.id}/datos.enc`,b=objetos.get(nombre)!
      objetos.set(nombre,Buffer.from('corrupto'));await expect(simular(n,k,r.id)).rejects.toThrow('inventario')
      objetos.delete(nombre);await expect(simular(n,k,r.id)).rejects.toThrow('ausente')
      objetos.set(nombre,b)
      await expect(simular({...n,c:{...conf,base:'otra'}},k,r.id)).rejects.toThrow('instalación')
      await expect(simular(n,randomBytes(32),r.id)).rejects.toThrow('autenticar')
      await expect(simular(n,k,'../../otro')).rejects.toThrow('Identificador')
    }finally{db.close()}
  })
  it('nunca pisa una carpeta existente y limpia sus temporales',async()=>{
    const {n,db}=escenario(),k=randomBytes(32)
    try{await temporal(async d=>{
      const r=await crearCopia(n,k),destino=join(d,'existente');await mkdir(destino);await writeFile(join(destino,'conservar'),'original')
      await expect(simular(n,k,r.id,destino)).rejects.toThrow()
      expect(await readFile(join(destino,'conservar'),'utf8')).toBe('original')
      expect(await readdir(d)).toEqual(['existente'])
    })}finally{db.close()}
  })
  it('rechaza bases con restauración activa y relaciones rotas',async()=>{
    const {n,db,exportacion}=escenario()
    try{await temporal(async d=>{
      const e=await n.esquema()
      db.exec("UPDATE config SET valor='1' WHERE clave='restauracion'")
      await writeFile(join(d,'datos'),exportacion())
      await expect(restaurarBase(join(d,'datos'),e,join(d,'base1'))).rejects.toThrow('protecciones')
      db.exec("PRAGMA foreign_keys=OFF; UPDATE archivos SET paciente_id=99999; UPDATE config SET valor='0' WHERE clave='restauracion'")
      await writeFile(join(d,'datos'),exportacion())
      await expect(restaurarBase(join(d,'datos'),e,join(d,'base2'))).rejects.toThrow('relaciones')
    })}finally{db.close()}
  })
  it('conserva también archivos anulados y detecta huellas contradictorias',()=>{
    const {db}=escenario()
    try{
      db.exec("UPDATE archivos SET anulado_en='2030-01-01T00:00:00Z',anulado_motivo='Ficticio'")
      expect(referencias(db).some(x=>x.clave==='estudios/../ficticio.pdf')).toBe(true)
      db.prepare("INSERT INTO documentos(paciente_id,tipo,datos,fecha,pdf_clave,pdf_sha256) VALUES (1,'certificado','{}','2030-01-01',?,?)").run('estudios/../ficticio.pdf','a'.repeat(64))
      expect(()=>referencias(db)).toThrow('contradictorias')
    }finally{db.close()}
  })
})

describe('Puerto Cloudflare',()=>{
  it('valida configuración y buckets separados',()=>{
    expect(()=>configuracion({})).toThrow('Falta configurar')
    const env={CLOUDFLARE_ACCOUNT_ID:conf.cuenta,RESPALDOS_D1_ID:conf.base,RESPALDOS_ARCHIVOS_BUCKET:conf.archivos,RESPALDOS_BUCKET:conf.respaldos,CLOUDFLARE_API_TOKEN:conf.token}
    expect(configuracion(env)).toEqual(conf)
    expect(()=>configuracion({...env,RESPALDOS_BUCKET:conf.archivos})).toThrow('inválidos')
  })
  it('sigue el bookmark de D1 y descarga SQL sin filtrar la credencial a la URL firmada',async()=>temporal(async d=>{
    const llamadas:{url:string;init?:RequestInit}[]=[]
    const pedir=async(url:string|URL|Request,init?:RequestInit)=>{
      llamadas.push({url:String(url),init})
      if(llamadas.length===1)return Response.json({success:true,result:{success:true,status:'active',at_bookmark:'marca'}})
      if(llamadas.length===2)return Response.json({success:true,result:{success:true,status:'complete',result:{signed_url:'https://ficticio.example/base.sql?firma=privada'}}})
      return new Response('INSERT INTO ficticio VALUES (1);')
    }
    await new Nube(conf,pedir as typeof fetch).exportar(join(d,'datos'))
    expect(JSON.parse(String(llamadas[1].init?.body)).current_bookmark).toBe('marca')
    expect(JSON.parse(String(llamadas[0].init?.body)).dump_options.no_schema).toBe(true)
    expect(new Headers(llamadas[0].init?.headers).get('Authorization')).toBe('Bearer '+conf.token)
    expect(new Headers(llamadas[2].init?.headers).has('Authorization')).toBe(false)
    expect(await readFile(join(d,'datos'),'utf8')).toContain('INSERT')
  }))
  it('no muestra el cuerpo del error de Cloudflare ni sigue redirecciones',async()=>{
    const n=new Nube(conf,(async(_u,init)=>{expect(init?.redirect).toBe('error');return new Response('SECRETO-no-mostrar',{status:403})}) as typeof fetch)
    await expect(n.esquema()).rejects.toThrow('403');await expect(n.esquema()).rejects.not.toThrow('SECRETO')
  })
  it('codifica las claves de R2 y transmite los bytes, sin usar rutas locales externas',async()=>temporal(async d=>{
    const n=new Nube(conf,(async(url)=>{expect(String(url)).toContain('/objects/uno%2Fa%20b%3F%23.pdf');return new Response('original',{headers:{'Content-Type':'application/pdf'}})}) as typeof fetch)
    expect(await n.bajar(conf.archivos,'uno/a b?#.pdf',join(d,'b'))).toBe('application/pdf')
    expect(await huella(join(d,'b'))).toEqual({sha256:hash(Buffer.from('original')),bytes:8})
  }))
})

// Usa la exportación REAL de D1 local de Wrangler, además del adaptador SQLite de las pruebas rápidas.
it('simulacro de una exportación D1 local real con todas las migraciones y la semilla ficticia',async()=>temporal(async d=>{
  const config=join(d,'wrangler.json'),sql=join(d,'semilla.sql'),cli=resolve('node_modules/wrangler/bin/wrangler.js')
  await writeFile(config,JSON.stringify({name:'respaldo-ficticio',compatibility_date:'2026-10-01',d1_databases:[{binding:'DB',database_name:'respaldo-ficticio',database_id:'00000000-0000-0000-0000-000000000000'}]}))
  const migraciones=readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort().map(x=>readFileSync('migrations/'+x,'utf8')).join('\n')
  const contador="\nUPDATE sqlite_sequence SET seq=1000 WHERE name='pacientes';"
  await writeFile(sql,migraciones+'\n'+readFileSync('seed/seed.sql','utf8')+contador)
  const wrangler=async(args:string[])=>promisify(execFile)(process.execPath,[cli,...args,'--config',config],{env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:8*1024*1024})
  await wrangler(['d1','execute','DB','--local','--file',sql])
  const original=new DatabaseSync(':memory:');original.exec(migraciones+'\n'+readFileSync('seed/seed.sql','utf8')+contador)
  try{
    const {stdout}=await wrangler(['d1','execute','DB','--local','--json','--command',ESQUEMA])
    const esquema=JSON.parse(stdout)[0].results as ObjetoSQL[]
    await wrangler(['d1','export','DB','--local','--no-schema','--output',join(d,'exportado.sql')])
    const restaurada=await restaurarBase(join(d,'exportado.sql'),esquema,join(d,'restaurada.sqlite'))
    try{
      expect(restaurada.prepare('SELECT id,dni,nombre,apellido FROM pacientes').all()).toEqual(original.prepare('SELECT id,dni,nombre,apellido FROM pacientes').all())
      expect(restaurada.prepare('SELECT * FROM numeradores').all()).toEqual(original.prepare('SELECT * FROM numeradores').all())
      expect(restaurada.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()).toEqual(original.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all())
      expect(restaurada.prepare("INSERT INTO pacientes(dni,nombre,apellido,celular) VALUES ('99999999','Ficticio','Restaurado','3430000000')").run().lastInsertRowid).toBe(1001)
      expect(errorDe(restaurada,'DELETE FROM pagos')).toMatch(/borra/)
      expect(restaurada.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get()).toEqual(original.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get())
    }finally{restaurada.close()}
  }finally{original.close()}
}),60_000)
