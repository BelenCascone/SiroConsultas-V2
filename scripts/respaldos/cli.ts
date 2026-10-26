// Node 22.18+ · sin dependencias. Nunca imprime SQL, claves de archivo, URLs firmadas ni credenciales.
import {claveDe} from './cifrado.ts'
import {Nube,configuracion} from './nube.ts'
import {crearCopia,simular} from './copia.ts'
try {
  const [accion,id,destino]=process.argv.slice(2)
  if(!['crear','simular'].includes(accion)||accion==='crear'&&(id||destino)||accion==='simular'&&!id)throw new Error('Uso: crear | simular <id> [carpeta nueva]')
  const n=new Nube(configuracion(process.env)),clave=claveDe(process.env.RESPALDOS_CLAVE)
  if(accion==='crear'){
    console.log('Generando respaldo cifrado de D1 y archivos…')
    const r=await crearCopia(n,clave)
    console.log('Verificando una restauración descargada del bucket de respaldos…')
    const informe=await simular(n,clave,r.id)
    await n.consulta('INSERT INTO respaldos (clave,sha256,tamano) VALUES (?,?,?)',[r.clave,r.sha256,r.tamano])
    console.log(JSON.stringify(informe))
  }else console.log(JSON.stringify(await simular(n,clave,id,destino)))
}catch{
  console.error('No se completó el respaldo o su verificación. Revisá acceso, clave, originales e inventario según docs/RESPALDOS.md.')
  process.exitCode=1
}
