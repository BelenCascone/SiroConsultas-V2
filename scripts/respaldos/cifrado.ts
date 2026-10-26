// Formato SCRESP01: cabecera autenticada, IV aleatorio y AES-256-GCM; gzip antes de cifrar.
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto'
import {createReadStream,createWriteStream} from 'node:fs'
import {open,stat,unlink,appendFile} from 'node:fs/promises'
import {pipeline} from 'node:stream/promises'
import {createGzip,createGunzip} from 'node:zlib'

const MAGIC=Buffer.from('SCRESP01'),CABECERA=20,TAG=16
export function claveDe(valor:string|undefined) {
  if(!valor||!/^[a-f0-9]{64}$/i.test(valor))throw new Error('RESPALDOS_CLAVE debe tener 32 bytes aleatorios en hexadecimal.')
  return Buffer.from(valor,'hex')
}
export async function huella(ruta:string) {
  const hash=createHash('sha256');let bytes=0
  for await(const parte of createReadStream(ruta)){hash.update(parte);bytes+=parte.length}
  return {sha256:hash.digest('hex'),bytes}
}
export async function cifrar(origen:string,destino:string,clave:Buffer) {
  const iv=randomBytes(12),cabecera=Buffer.concat([MAGIC,iv]),c=createCipheriv('aes-256-gcm',clave,iv)
  c.setAAD(cabecera)
  const archivo=await open(destino,'wx',0o600)
  try{await archivo.write(cabecera)}finally{await archivo.close()}
  try {
    await pipeline(createReadStream(origen),createGzip(),c,createWriteStream(destino,{flags:'r+',start:CABECERA,mode:0o600}))
    await appendFile(destino,c.getAuthTag())
  }catch(e){await unlink(destino).catch(()=>{});throw e}
}
export async function descifrar(origen:string,destino:string,clave:Buffer) {
  const n=(await stat(origen)).size
  if(n<CABECERA+TAG)throw new Error('Respaldo truncado.')
  const f=await open(origen,'r'),cabecera=Buffer.alloc(CABECERA),tag=Buffer.alloc(TAG)
  try {await f.read(cabecera,0,CABECERA,0);await f.read(tag,0,TAG,n-TAG)}finally{await f.close()}
  if(!cabecera.subarray(0,8).equals(MAGIC))throw new Error('Formato de respaldo desconocido.')
  const d=createDecipheriv('aes-256-gcm',clave,cabecera.subarray(8));d.setAAD(cabecera);d.setAuthTag(tag)
  const salida=await open(destino,'wx',0o600);await salida.close()
  try {
    // El destino siempre es privado y provisional: solo se publica después de autenticar y verificar todo.
    await pipeline(createReadStream(origen,{start:CABECERA,end:n-TAG-1}),d,createGunzip(),createWriteStream(destino,{flags:'r+',mode:0o600}))
  }catch{await unlink(destino).catch(()=>{});throw new Error('No se pudo autenticar el respaldo: clave incorrecta o copia dañada.')}
}
