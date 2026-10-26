import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,readFile,writeFile,rm,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,dirname} from 'node:path'
import {cifrar,descifrar,huella} from './cifrado.ts'
import {restaurarBase,referencias,resumen,guardarEsquema,type ObjetoSQL} from './base.ts'
import type {Config} from './nube.ts'
export type Puerto={c:Config;esquema():Promise<ObjetoSQL[]>;exportar(destino:string):Promise<void>;bajar(bucket:string,clave:string,destino:string):Promise<string|null>;subir(clave:string,origen:string):Promise<void>;consulta(sql:string,params?:unknown[]):Promise<unknown[]>}
type Pieza={objeto:string;sha256:string;bytes:number;cifrado_sha256:string;cifrado_bytes:number}
type Archivo=Pieza&{clave:string;mime:string|null}
export type Manifiesto={version:1;id:string;creado:string;cuenta:string;base:string;bucket:string;datos:Pieza;esquema:Pieza;archivos:Archivo[];filas:Record<string,number>}
const ID=/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[a-f0-9-]{36}$/
const prefijo=(id:string)=>{if(!ID.test(id))throw new Error('Identificador de respaldo inválido.');return `v1/${id}/`}
export async function temporal<T>(trabajo:(dir:string)=>Promise<T>) {
  const dir=await mkdtemp(join(tmpdir(),'siro-respaldo-'))
  try{return await trabajo(dir)}finally{await rm(dir,{recursive:true,force:true})}
}
export async function crearCopia(n:Puerto,clave:Buffer) {
  return temporal(async dir=>{
    const id=new Date().toISOString().slice(0,19).replaceAll(':','-')+'Z-'+randomUUID(),p=prefijo(id)
    const esquema=await n.esquema()
    await n.exportar(join(dir,'datos.sql'))
    // Un despliegue concurrente no puede dejar datos nuevos con un esquema viejo.
    if(JSON.stringify(esquema)!==JSON.stringify(await n.esquema()))throw new Error('El esquema cambió durante el respaldo. Reintentá después del despliegue.')
    await guardarEsquema(join(dir,'esquema.json'),esquema)
    const db=await restaurarBase(join(dir,'datos.sql'),esquema,join(dir,'base.sqlite'))
    let refs,filas
    try{refs=referencias(db);filas=resumen(db)}finally{db.close()}
    const pieza=async(nombre:string,origen:string):Promise<Pieza>=>{
      const plain=await huella(origen),destino=join(dir,'cifrado')
      await cifrar(origen,destino,clave)
      const cripto=await huella(destino)
      await n.subir(p+nombre,destino);await rm(destino)
      return {objeto:nombre,...plain,cifrado_sha256:cripto.sha256,cifrado_bytes:cripto.bytes}
    }
    const datos=await pieza('datos.enc',join(dir,'datos.sql')),estructura=await pieza('esquema.enc',join(dir,'esquema.json')),archivos:Archivo[]=[]
    for(const [i,ref]of refs.entries()){
      const ruta=join(dir,'original'),mime=await n.bajar(n.c.archivos,ref.clave,ruta),hash=await huella(ruta)
      if(ref.sha256&&hash.sha256!==ref.sha256)throw new Error('Un original no coincide con su huella clínica.')
      archivos.push({...await pieza(`archivos/${String(i).padStart(8,'0')}.enc`,ruta),clave:ref.clave,mime:ref.mime??mime});await rm(ruta)
    }
    const manifiesto:Manifiesto={version:1,id,creado:new Date().toISOString(),cuenta:n.c.cuenta,base:n.c.base,bucket:n.c.archivos,datos,esquema:estructura,archivos,filas}
    await writeFile(join(dir,'manifiesto.json'),JSON.stringify(manifiesto),{flag:'wx',mode:0o600})
    await cifrar(join(dir,'manifiesto.json'),join(dir,'manifiesto.enc'),clave)
    // El manifiesto cifrado se escribe ÚLTIMO: las carpetas sin él no son copias completas.
    await n.subir(p+'manifiesto.enc',join(dir,'manifiesto.enc'))
    return {id,clave:p+'manifiesto.enc',...await huella(join(dir,'manifiesto.enc')),tamano:datos.cifrado_bytes+estructura.cifrado_bytes+archivos.reduce((a,x)=>a+x.cifrado_bytes,0)+(await huella(join(dir,'manifiesto.enc'))).bytes}
  })
}
function validarManifiesto(m:Manifiesto,id:string,n:Puerto) {
  if(m.version!==1||m.id!==id||m.cuenta!==n.c.cuenta||m.base!==n.c.base||m.bucket!==n.c.archivos||!Array.isArray(m.archivos)||!m.filas)throw new Error('El respaldo no corresponde a esta instalación o versión.')
  const piezas=[m.datos,m.esquema,...m.archivos],nombres=new Set<string>()
  for(const x of piezas){
    if(!x||!['datos.enc','esquema.enc'].includes(x.objeto)&&!/^archivos\/\d{8}\.enc$/.test(x.objeto)||nombres.has(x.objeto)||![x.sha256,x.cifrado_sha256].every(h=>/^[a-f0-9]{64}$/.test(h))||![x.bytes,x.cifrado_bytes].every(v=>Number.isSafeInteger(v)&&v>=0))throw new Error('Inventario de respaldo inválido.')
    nombres.add(x.objeto)
  }
  if(m.datos.objeto!=='datos.enc'||m.esquema.objeto!=='esquema.enc'||new Set(m.archivos.map(x=>x.clave)).size!==m.archivos.length||m.archivos.some(x=>typeof x.clave!=='string'||!x.clave))throw new Error('Inventario de archivos inválido.')
}
export async function simular(n:Puerto,clave:Buffer,id:string,destino?:string) {
  const p=prefijo(id)
  return temporal(async dir=>{
    await n.bajar(n.c.respaldos,p+'manifiesto.enc',join(dir,'m.enc'))
    await descifrar(join(dir,'m.enc'),join(dir,'manifiesto.json'),clave)
    const m=JSON.parse(await readFile(join(dir,'manifiesto.json'),'utf8')) as Manifiesto
    validarManifiesto(m,id,n)
    const descargar=async(x:Pieza,ruta:string)=>{
      const enc=join(dir,'pieza.enc');await n.bajar(n.c.respaldos,p+x.objeto,enc)
      const ch=await huella(enc)
      if(ch.sha256!==x.cifrado_sha256||ch.bytes!==x.cifrado_bytes)throw new Error('El archivo cifrado no coincide con el inventario.')
      await descifrar(enc,ruta,clave);await rm(enc)
      const h=await huella(ruta)
      if(h.sha256!==x.sha256||h.bytes!==x.bytes)throw new Error('El original restaurado no coincide con el inventario.')
    }
    await descargar(m.datos,join(dir,'datos.sql'));await descargar(m.esquema,join(dir,'esquema.json'))
    const esquema=JSON.parse(await readFile(join(dir,'esquema.json'),'utf8')) as ObjetoSQL[]
    const db=await restaurarBase(join(dir,'datos.sql'),esquema,join(dir,'base.sqlite'))
    let refs,filas
    try{refs=referencias(db);filas=resumen(db)}finally{db.close()}
    if(JSON.stringify(filas)!==JSON.stringify(m.filas)||refs.length!==m.archivos.length)throw new Error('La base restaurada no coincide con el inventario.')
    await mkdir(join(dir,'archivos'),{mode:0o700})
    for(const [i,a]of m.archivos.entries()){
      const ref=refs.find(r=>r.clave===a.clave)
      if(!ref||ref.sha256&&ref.sha256!==a.sha256)throw new Error('Falta un original requerido por la base.')
      // El nombre del objeto NUNCA se usa como ruta local (puede contener barras o ../).
      await descargar(a,join(dir,'archivos',String(i).padStart(8,'0')))
    }
    const informe={version:1,respaldo:id,verificado_en:new Date().toISOString(),archivos:m.archivos.length,filas,integridad:'ok',relaciones:'ok',huellas:'ok',restauracion:'0'}
    if(destino){
      // Publicación en una carpeta NUEVA: no sobrescribe bases, archivos ni directorios existentes.
      const absoluta=resolve(destino),staging=await mkdtemp(join(dirname(absoluta),'.siro-restaurado-'))
      try{
        const {copyFile,cp}=await import('node:fs/promises')
        for(const f of ['base.sqlite','datos.sql','esquema.json','manifiesto.json'])await copyFile(join(dir,f),join(staging,f))
        await cp(join(dir,'archivos'),join(staging,'archivos'),{recursive:true})
        await writeFile(join(staging,'VERIFICACION.json'),JSON.stringify(informe,null,2),{mode:0o600})
        // mkdir es exclusivo incluso si existe un symlink: no se sigue un destino ajeno.
        await mkdir(absoluta,{mode:0o700})
        try{await rename(staging,join(absoluta,'copia'))}catch(e){await rm(absoluta,{recursive:true,force:true});throw e}
      }finally{await rm(staging,{recursive:true,force:true})}
    }
    return informe
  })
}
