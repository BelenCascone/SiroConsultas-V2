import {createReadStream,createWriteStream} from 'node:fs'
import {stat} from 'node:fs/promises'
import {pipeline} from 'node:stream/promises'
import {Readable} from 'node:stream'
import {setTimeout as esperar} from 'node:timers/promises'
import type {ObjetoSQL} from './base.ts'
export type Config={cuenta:string;base:string;archivos:string;respaldos:string;token:string}
export const ESQUEMA="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY type,name"
export function configuracion(e:NodeJS.ProcessEnv):Config {
  const campos=['CLOUDFLARE_ACCOUNT_ID','RESPALDOS_D1_ID','RESPALDOS_ARCHIVOS_BUCKET','RESPALDOS_BUCKET','CLOUDFLARE_API_TOKEN'] as const
  if(campos.some(k=>!e[k]))throw new Error('Falta configurar el acceso a D1/R2 del respaldo (ver docs/RESPALDOS.md).')
  const [cuenta,base,archivos,respaldos,token]=campos.map(k=>e[k]!)
  if(!/^[a-f0-9]{32}$/i.test(cuenta)||!/^[a-f0-9-]{36}$/i.test(base)||![archivos,respaldos].every(b=>/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(b))||archivos===respaldos)throw new Error('Identificadores de respaldo inválidos.')
  return {cuenta,base,archivos,respaldos,token}
}
export class Nube {
  readonly c:Config
  readonly pedir:typeof fetch
  constructor(c:Config,pedir:typeof fetch=fetch){this.c=c;this.pedir=pedir}
  async api(ruta:string,init:RequestInit={}) {
    const h=new Headers(init.headers);h.set('Authorization',`Bearer ${this.c.token}`)
    const r=await this.pedir(`https://api.cloudflare.com/client/v4/accounts/${this.c.cuenta}/${ruta}`,{...init,headers:h,redirect:'error',signal:AbortSignal.timeout(300_000)})
    if(!r.ok)throw new Error(`Cloudflare rechazó la operación de respaldo (${r.status}).`)
    return r
  }
  async consulta(sql:string,params:unknown[]=[]) {
    const r=await this.api(`d1/database/${this.c.base}/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql,params})})
    const j=await r.json() as {success:boolean;result:{success:boolean;results:unknown[]}[]}
    if(!j.success||j.result.some(x=>!x.success))throw new Error('Falló una consulta operativa de respaldo.')
    return j.result[0].results
  }
  async esquema(){return await this.consulta(ESQUEMA) as ObjetoSQL[]}
  async exportar(destino:string) {
    let bookmark:string|undefined
    for(let intento=0;intento<180;intento++){
      const r=await this.api(`d1/database/${this.c.base}/export`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({output_format:'polling',dump_options:{no_schema:true,no_data:false,tables:[]},current_bookmark:bookmark})})
      const j=await r.json() as {success:boolean;result:{success:boolean;status:string;at_bookmark?:string;result?:{signed_url:string}}}
      const x=j.result
      if(!j.success||!x.success||x.status==='error')throw new Error('D1 no pudo generar la exportación.')
      if(x.status==='complete'){
        const url=new URL(x.result!.signed_url)
        if(url.protocol!=='https:')throw new Error('Dirección de exportación insegura.')
        // La URL firmada nunca recibe el token de la API y nunca se escribe en el log.
        const descarga=await this.pedir(url,{redirect:'error',signal:AbortSignal.timeout(300_000)})
        if(!descarga.ok||!descarga.body)throw new Error('No se pudo descargar la exportación D1.')
        await pipeline(Readable.fromWeb(descarga.body as never),createWriteStream(destino,{flags:'wx',mode:0o600}));return
      }
      bookmark=x.at_bookmark;await esperar(1000)
    }
    throw new Error('D1 excedió el tiempo de exportación.')
  }
  objeto(bucket:string,clave:string){return `r2/buckets/${bucket}/objects/${encodeURIComponent(clave)}`}
  async bajar(bucket:string,clave:string,destino:string) {
    const r=await this.api(this.objeto(bucket,clave))
    if(!r.body)throw new Error('Falta el contenido del archivo.')
    await pipeline(Readable.fromWeb(r.body as never),createWriteStream(destino,{flags:'wx',mode:0o600}))
    return r.headers.get('Content-Type')
  }
  async subir(clave:string,origen:string) {
    const n=(await stat(origen)).size
    // Límite del endpoint usado por Wrangler. Nunca se publica una copia parcial como completa.
    if(n>300*1024*1024)throw new Error('Un objeto cifrado supera los 300 MB admitidos por esta herramienta.')
    await this.api(this.objeto(this.c.respaldos,clave),{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(n)},body:createReadStream(origen) as never,duplex:'half'} as RequestInit)
  }
}
