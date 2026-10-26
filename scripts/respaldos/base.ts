// La exportación D1 de datos se restaura con su esquema real, creando los triggers AL FINAL.
// Así nunca hay que habilitar config.restauracion en una base en servicio.
import {DatabaseSync} from 'node:sqlite'
import {readFile,writeFile} from 'node:fs/promises'
export type ObjetoSQL={type:string;name:string;tbl_name:string;sql:string}
export type Referencia={clave:string;sha256:string|null;mime:string|null}
const id=(s:string)=>'"'+s.replaceAll('"','""')+'"'
export function validarBase(db:DatabaseSync) {
  if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw new Error('La base restaurada no pasa integrity_check.')
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('La base restaurada tiene relaciones rotas.')
  if(db.prepare("SELECT valor FROM config WHERE clave='restauracion'").get()?.valor!=='0')throw new Error('La base no tiene las protecciones de restauración desactivadas.')
}
export async function restaurarBase(datos:string,esquema:ObjetoSQL[],destino:string) {
  if(!esquema.length||esquema.some(o=>!['table','index','view','trigger'].includes(o.type)||!o.sql))throw new Error('Esquema incompleto.')
  const db=new DatabaseSync(destino)
  try {
    db.exec('PRAGMA foreign_keys=OFF; BEGIN')
    for(const o of esquema.filter(o=>o.type==='table'))db.exec(o.sql)
    db.exec(await readFile(datos,'utf8'))
    // La exportación D1 incluye sqlite_sequence: los INSERT anteriores ya crearon filas.
    // SQLite no impone unicidad allí; consolidar por máximo conserva el contador incluso si se borró el ID mayor.
    db.exec('CREATE TEMP TABLE _siro_secuencias AS SELECT name,MAX(seq) seq FROM sqlite_sequence GROUP BY name; DELETE FROM sqlite_sequence; INSERT INTO sqlite_sequence SELECT name,seq FROM _siro_secuencias; DROP TABLE temp._siro_secuencias;')
    for(const tipo of ['index','view','trigger'])for(const o of esquema.filter(o=>o.type===tipo))db.exec(o.sql)
    db.exec('COMMIT; PRAGMA foreign_keys=ON')
    validarBase(db)
    return db
  }catch(e){db.close();throw e}
}
export function referencias(db:DatabaseSync):Referencia[] {
  const filas=db.prepare(`SELECT clave,sha256,mime FROM archivos
    UNION ALL SELECT pdf_clave,pdf_sha256,'application/pdf' FROM documentos WHERE pdf_clave IS NOT NULL
    UNION ALL SELECT pdf_clave,pdf_sha256,'application/pdf' FROM comprobantes WHERE pdf_clave IS NOT NULL
    UNION ALL SELECT foto_clave,NULL,NULL FROM profesional WHERE foto_clave IS NOT NULL
    UNION ALL SELECT transferencia_qr_clave,NULL,NULL FROM profesional WHERE transferencia_qr_clave IS NOT NULL
    UNION ALL SELECT comprobante_logo_clave,NULL,NULL FROM profesional WHERE comprobante_logo_clave IS NOT NULL`).all() as Referencia[]
  // El logo congelado de un comprobante puede ser distinto del logo actual.
  for(const f of db.prepare("SELECT foto FROM comprobantes WHERE json_valid(foto)").all()){
    const foto=JSON.parse(String(f.foto)),clave=foto?.profesional?.comprobante_logo_clave
    if(clave)filas.push({clave,sha256:foto.logo_sha256??null,mime:null})
  }
  const unicos=new Map<string,Referencia>()
  for(const f of filas){
    if(typeof f.clave!=='string'||!f.clave||f.clave.length>1024||f.sha256&&!/^[a-f0-9]{64}$/i.test(f.sha256))throw new Error('Referencia de archivo inválida.')
    const previo=unicos.get(f.clave)
    if(previo?.sha256&&f.sha256&&previo.sha256!==f.sha256)throw new Error('Un archivo tiene huellas contradictorias.')
    unicos.set(f.clave,{clave:f.clave,sha256:f.sha256??previo?.sha256??null,mime:f.mime??previo?.mime??null})
  }
  return [...unicos.values()].sort((a,b)=>a.clave.localeCompare(b.clave))
}
export function resumen(db:DatabaseSync) {
  const tablas=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  return Object.fromEntries(tablas.map(t=>[String(t.name),Number(db.prepare(`SELECT COUNT(*) n FROM ${id(String(t.name))}`).get()!.n)]))
}
export async function guardarEsquema(destino:string,esquema:ObjetoSQL[]) {await writeFile(destino,JSON.stringify(esquema),{flag:'wx',mode:0o600})}
