// X4 · Configuración de cobros, imágenes raster y comprobante interno inmutable.
import { ErrorDocumento, crc32, unir, pdf, sha256, texto, type ImagenPdf } from './documentos'
import { ahoraAR } from './fechas'
import type { Bindings } from '../tipos'

export const COLORES = [['teal','Verde azulado','#24605F'],['azul','Azul','#1D5FB8'],['violeta','Violeta','#5B3F8C'],['holly','Holly','#02261E']] as const
export const MEDIOS: Record<string,string> = {efectivo:'Efectivo',transferencia:'Transferencia',tarjeta:'Tarjeta',otro:'Otro'}
export type PerfilCobros = {
  nombre:string|null;matricula:string|null;especialidad:string|null;cuit:string|null;condicion_iva:string|null;domicilio_fiscal:string|null;punto_venta:number|null;arca_estado:string
  transferencia_alias:string|null;transferencia_cbu:string|null;transferencia_titular:string|null;transferencia_qr_clave:string|null
  comprobante_logo_clave:string|null;comprobante_color:string|null;comprobante_pie:string|null;correo_contadora:string|null;cobro_ausencia_activo:number;cobro_ausencia_horas:number
}
export const CAMPOS = ['cuit','condicion_iva','domicilio_fiscal','punto_venta','transferencia_alias','transferencia_cbu','transferencia_titular','comprobante_color','comprobante_pie','correo_contadora','cobro_ausencia_activo','cobro_ausencia_horas'] as const
export const leerPerfil = (db:D1Database) => db.prepare('SELECT nombre,matricula,especialidad,cuit,condicion_iva,domicilio_fiscal,punto_venta,arca_estado,transferencia_alias,transferencia_cbu,transferencia_titular,transferencia_qr_clave,comprobante_logo_clave,comprobante_color,comprobante_pie,correo_contadora,cobro_ausencia_activo,cobro_ausencia_horas FROM profesional WHERE id=1').first<PerfilCobros>()
export const claseColor = (color:string|null) => `comp-${COLORES.find(c=>c[2].toLowerCase()===color?.toLowerCase())?.[0] ?? 'teal'}`
const digitos = (s:string) => s.replace(/[\s.-]/g,'')
export function cuitValido(s:string) {
  if (!/^\d{11}$/.test(s) || /^0+$/.test(s)) return false
  const suma=[5,4,3,2,7,6,5,4,3,2].reduce((n,p,i)=>n+p*Number(s[i]),0),v=11-suma%11
  return v!==10 && Number(s[10])===(v===11 ? 0 : v)
}
export function cbuValido(s:string) {
  if (!/^\d{22}$/.test(s) || /^0+$/.test(s)) return false
  const control=(inicio:number,pesos:number[]) => (10-pesos.reduce((n,p,i)=>n+p*Number(s[inicio+i]),0)%10)%10
  return control(0,[7,1,3,9,7,1,3])===Number(s[7]) && control(8,[3,9,7,1,3,9,7,1,3,9,7,1,3])===Number(s[21])
}
export function configurar(f:FormData) {
  const cuit=digitos(texto(f,'cuit',20)),cbu=digitos(texto(f,'transferencia_cbu',32)),pv=texto(f,'punto_venta',5),iva=texto(f,'condicion_iva',20),color=texto(f,'comprobante_color',7)||COLORES[0][2]
  if(cuit && !cuitValido(cuit)) throw new ErrorDocumento('Revisá el CUIT: debe tener 11 dígitos y un dígito verificador válido.')
  if(cbu && !cbuValido(cbu)) throw new ErrorDocumento('Revisá el CBU o CVU: debe tener 22 dígitos y sus verificadores válidos.')
  if(pv && (!/^\d+$/.test(pv)||Number(pv)<1||Number(pv)>99999)) throw new ErrorDocumento('El punto de venta va del 1 al 99999.')
  if(iva && !['monotributo','exento'].includes(iva)) throw new ErrorDocumento('Elegí tu condición frente al IVA.')
  if(!COLORES.some(c=>c[2].toLowerCase()===color.toLowerCase())) throw new ErrorDocumento('Elegí uno de los colores del comprobante.')
  const horas=texto(f,'cobro_ausencia_horas',3)||'24'
  if(!/^\d+$/.test(horas)||Number(horas)<1||Number(horas)>168) throw new ErrorDocumento('Las horas de anticipación van de 1 a 168.')
  const correo=texto(f,'correo_contadora',200)
  if(correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new ErrorDocumento('Revisá el correo de tu contadora.')
  const alias=texto(f,'transferencia_alias',40)
  if(alias && !/^[a-z\d.-]{6,40}$/i.test(alias)) throw new ErrorDocumento('El alias admite entre 6 y 40 letras, números, puntos y guiones.')
  return {cuit:cuit||null,condicion_iva:iva||null,domicilio_fiscal:texto(f,'domicilio_fiscal',200)||null,punto_venta:pv?Number(pv):null,transferencia_alias:alias||null,transferencia_cbu:cbu||null,transferencia_titular:texto(f,'transferencia_titular',120)||null,comprobante_color:color,comprobante_pie:texto(f,'comprobante_pie',300)||null,correo_contadora:correo||null,cobro_ausencia_activo:f.get('cobro_ausencia_activo')==='1'?1:0,cobro_ausencia_horas:Number(horas)}
}

async function transformar(b:Uint8Array,tipo:'comprimir'|'descomprimir',limite:number) {
  const transformador=tipo==='comprimir'?new CompressionStream('deflate'):new DecompressionStream('deflate')
  const lector=new Response(new Blob([new Uint8Array(b).buffer]).stream().pipeThrough(transformador)).body!.getReader()
  const partes:Uint8Array[]=[];let n=0
  try {for(;;){const r=await lector.read();if(r.done)break;n+=r.value.length;if(n>limite)throw new ErrorDocumento('La imagen descomprimida supera el tamaño admitido.');partes.push(r.value)}} catch(e){await lector.cancel().catch(()=>{});throw e}
  return unir(partes)
}
/** Se normaliza el PNG a RGB sobre blanco. No se incorporan metadatos ni contenido activo al PDF. */
export async function imagen(bytes:Uint8Array):Promise<ImagenPdf> {
  const fallo=()=>new ErrorDocumento('Elegí una imagen JPG o PNG válida, de hasta 2 MB y un millón de píxeles. PNG sin entrelazado, de hasta 8 bits por canal.')
  if(bytes.length>2*1024*1024 || bytes.length<24)throw fallo()
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  if(bytes[0]===255&&bytes[1]===216) {
    let p=2,ancho=0,alto=0,canales=0,sos=false
    while(p<bytes.length-1){if(bytes[p++]!==255)throw fallo();while(bytes[p]===255)p++;const m=bytes[p++];if(m===0xd9)break;if(p+2>bytes.length)throw fallo();const n=v.getUint16(p);if(n<2||p+n>bytes.length)throw fallo();if([0xc0,0xc1,0xc2].includes(m)){if(n<8||bytes[p+2]!==8)throw fallo();alto=v.getUint16(p+3);ancho=v.getUint16(p+5);canales=bytes[p+7]}if(m===0xda){sos=true;break}p+=n}
    if(!sos||!ancho||!alto||ancho*alto>1000000||![1,3].includes(canales)||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw fallo()
    return {ancho,alto,canales:canales as 1|3,datos:bytes,filtro:'DCTDecode'}
  }
  if(![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw fallo()
  let p=8,ancho=0,alto=0,prof=0,tipo=-1,fin=false,paleta=new Uint8Array(),transparencia=new Uint8Array()
  const idat:Uint8Array[]=[]
  while(p+12<=bytes.length){
    const n=v.getUint32(p),inicio=p+8
    if(n>bytes.length-p-12)throw fallo()
    const t=String.fromCharCode(...bytes.slice(p+4,p+8)),b=bytes.slice(inicio,inicio+n)
    if(crc32(bytes.subarray(p+4,inicio+n))!==v.getUint32(inicio+n))throw fallo()
    if(p===8&&t!=='IHDR')throw fallo()
    if(t==='IHDR'){if(ancho||n!==13)throw fallo();ancho=v.getUint32(inicio);alto=v.getUint32(inicio+4);prof=b[8];tipo=b[9];if(b[10]||b[11]||b[12])throw fallo()}
    else if(t==='PLTE')paleta=b
    else if(t==='tRNS')transparencia=b
    else if(t==='IDAT')idat.push(b)
    else if(t==='IEND'){fin=n===0&&inicio+4===bytes.length;break}
    else if(t[0]===t[0].toUpperCase())throw fallo()
    p=inicio+n+4
  }
  if(!fin||!ancho||!alto||ancho*alto>1000000||!idat.length||![0,2,3,4,6].includes(tipo)||![1,2,4,8].includes(prof)||(tipo!==0&&tipo!==3&&prof!==8))throw fallo()
  const canales=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[tipo],stride=Math.ceil(ancho*canales*prof/8),bpp=Math.max(1,Math.ceil(canales*prof/8)),esperado=(stride+1)*alto
  let crudo:Uint8Array
  try {crudo=await transformar(unir(idat),'descomprimir',esperado)} catch(e){if(e instanceof ErrorDocumento)throw e;throw fallo()}
  if(crudo.length!==esperado)throw fallo()
  const reconstruido=new Uint8Array(stride*alto),rgb=new Uint8Array(ancho*alto*3)
  const paeth=(a:number,b:number,c:number)=>{const q=a+b-c,da=Math.abs(q-a),db=Math.abs(q-b),dc=Math.abs(q-c);return da<=db&&da<=dc?a:db<=dc?b:c}
  for(let y=0;y<alto;y++){
    const f=crudo[y*(stride+1)];if(f>4)throw fallo()
    for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=bpp?reconstruido[i-bpp]:0,b=y?reconstruido[i-stride]:0,c=y&&x>=bpp?reconstruido[i-stride-bpp]:0;reconstruido[i]=(crudo[y*(stride+1)+1+x]+(f===0?0:f===1?a:f===2?b:f===3?Math.floor((a+b)/2):paeth(a,b,c)))&255}
    for(let x=0;x<ancho;x++){
      const i=y*stride+x*canales,indice=prof===8?reconstruido[i]:(reconstruido[y*stride+Math.floor(x*prof/8)]>>>(8-prof-(x*prof)%8))&((1<<prof)-1)
      let r:number,g:number,b:number,a=255
      if(tipo===3){if(indice*3+2>=paleta.length)throw fallo();r=paleta[indice*3];g=paleta[indice*3+1];b=paleta[indice*3+2];a=transparencia[indice]??255}
      else if(tipo===0||tipo===4){r=g=b=Math.round(indice*255/((1<<prof)-1));if(tipo===4)a=reconstruido[i+1];else if(transparencia.length===2&&indice===new DataView(transparencia.buffer).getUint16(0))a=0}
      else{r=reconstruido[i];g=reconstruido[i+1];b=reconstruido[i+2];if(tipo===6)a=reconstruido[i+3];else if(transparencia.length===6&&[r,g,b].every((c,j)=>c===new DataView(transparencia.buffer).getUint16(j*2)))a=0}
      const destino=(y*ancho+x)*3;rgb[destino]=Math.round((r*a+255*(255-a))/255);rgb[destino+1]=Math.round((g*a+255*(255-a))/255);rgb[destino+2]=Math.round((b*a+255*(255-a))/255)
    }
  }
  return {ancho,alto,canales:3,datos:await transformar(rgb,'comprimir',4*1024*1024),filtro:'FlateDecode'}
}
export async function archivoImagen(f:FormData,nombre:string) {
  const a=f.get(nombre)
  if(!a||typeof a==='string'||!a.size)return null
  const bytes=new Uint8Array(await a.arrayBuffer()),logo=await imagen(bytes),mime=logo.filtro==='DCTDecode'?'image/jpeg':'image/png'
  if(a.type!==mime)throw new ErrorDocumento('La imagen no coincide con el tipo de archivo indicado.')
  return {bytes,mime}
}

export type PagoComprobante={id:number;cobro_id:number;importe:number;medio:string;fecha:string;anulado_en:string|null;paciente_id:number;nombre:string;apellido:string;dni:string;celular:string;concepto:string;cobro_anulado:string|null;perdonado_en:string|null;baja_en:string|null}
export const leerPago=(db:D1Database,id:number)=>db.prepare(`SELECT p.id,p.cobro_id,p.importe,p.medio,p.fecha,p.anulado_en,c.paciente_id,c.concepto,c.anulado_en cobro_anulado,c.perdonado_en,pa.nombre,pa.apellido,pa.dni,pa.celular,pa.baja_en
  FROM pagos p JOIN cobros c ON c.id=p.cobro_id JOIN pacientes pa ON pa.id=c.paciente_id WHERE p.id=?`).bind(id).first<PagoComprobante>()
export type Receptor={nombre:string;tipo:'dni'|'cuit';doc:string}
export function receptor(f:FormData,p:PagoComprobante):Receptor {
  const quien=texto(f,'receptor',12,true)
  if(quien==='paciente')return {nombre:`${p.nombre} ${p.apellido}`,tipo:'dni',doc:p.dni}
  if(quien!=='otra')throw new ErrorDocumento('Elegí a nombre de quién se emite.')
  const nombre=texto(f,'receptor_nombre',160,true),tipo=texto(f,'receptor_doc_tipo',4,true),doc=digitos(texto(f,'receptor_doc',20,true))
  if(tipo==='dni'&&/^\d{6,10}$/.test(doc))return {nombre,tipo,doc}
  if(tipo==='cuit'&&cuitValido(doc))return {nombre,tipo,doc}
  throw new ErrorDocumento('Revisá el DNI o CUIT de la otra persona.')
}
export type FotoComprobante={profesional:Pick<PerfilCobros,'nombre'|'matricula'|'especialidad'|'cuit'|'condicion_iva'|'domicilio_fiscal'|'comprobante_logo_clave'|'comprobante_color'|'comprobante_pie'>;pago:PagoComprobante;receptor:Receptor;logo_sha256:string|null;emitido_por:string}
export type Comprobante={id:number;pago_id:number;tipo:string;numero:number;receptor_nombre:string;receptor_doc_tipo:string;receptor_doc:string;importe:number;fecha:string;estado:string;anulado_en:string|null;anulado_motivo:string|null;pdf_clave:string|null;pdf_sha256:string|null;foto:string}
export const numeroTexto=(n:number)=>String(n).padStart(8,'0')
export const leerComprobante=(db:D1Database,id:number)=>db.prepare('SELECT * FROM comprobantes WHERE id=?').bind(id).first<Comprobante>()
const porPago=(db:D1Database,id:number)=>db.prepare("SELECT * FROM comprobantes WHERE pago_id=? AND tipo IN ('interno','factura_c')").bind(id).first<Comprobante>()
export const importeTexto=(n:number)=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:2}).format(n/100)
export async function emitir(env:Bindings,pagoId:number,f:FormData,usuario:string) {
  const previo=await porPago(env.DB,pagoId)
  if(previo)return previo
  if(texto(f,'tipo',20,true)!=='interno')throw new ErrorDocumento('La factura C llega en la etapa 4.')
  const pago=await leerPago(env.DB,pagoId)
  if(!pago)throw new ErrorDocumento('No encontramos ese pago.',404)
  if(pago.anulado_en||pago.cobro_anulado||pago.perdonado_en||pago.baja_en)throw new ErrorDocumento('No se puede emitir: el pago, el cobro o la ficha están en solo lectura.',409)
  const prof=await leerPerfil(env.DB)
  if(!prof?.nombre?.trim()||!prof.matricula?.trim())throw new ErrorDocumento('Completá tu nombre y matrícula en Configuración antes de emitir.',409)
  const r=receptor(f,pago),fecha=ahoraAR().fecha
  // Solo los campos del documento, sin datos bancarios, secretos ni antecedentes clínicos.
  const profesional={nombre:prof.nombre,matricula:prof.matricula,especialidad:prof.especialidad,cuit:prof.cuit,condicion_iva:prof.condicion_iva,domicilio_fiscal:prof.domicilio_fiscal,comprobante_logo_clave:prof.comprobante_logo_clave,comprobante_color:prof.comprobante_color,comprobante_pie:prof.comprobante_pie}
  let logo:ImagenPdf|undefined,logoHash:string|null=null
  if(prof.comprobante_logo_clave){const obj=await env.ARCHIVOS.get(prof.comprobante_logo_clave);if(!obj)throw new ErrorDocumento('Falta el logo original. Revisá la configuración.',409);const b=new Uint8Array(await obj.arrayBuffer());logo=await imagen(b);logoHash=await sha256(b)}
  const fuente=await env.ASSETS?.fetch(new Request('https://assets.local/fuentes/documentos-dejavu-sans.ttf'))
  if(!fuente?.ok)throw new ErrorDocumento('No se pudo cargar la fuente del PDF. Probá de nuevo.',409)
  const fuenteBytes=new Uint8Array(await fuente.arrayBuffer()),foto:FotoComprobante={profesional,pago,receptor:r,logo_sha256:logoHash,emitido_por:usuario}
  const vigente=`p.id=? AND p.anulado_en IS NULL AND c.anulado_en IS NULL AND c.perdonado_en IS NULL AND pa.baja_en IS NULL`
  const origen='FROM pagos p JOIN cobros c ON c.id=p.cobro_id JOIN pacientes pa ON pa.id=c.paciente_id'
  for(let intento=0;intento<5;intento++){
    const anterior=await porPago(env.DB,pagoId);if(anterior)return anterior
    const n=Number((await env.DB.prepare("SELECT ultimo FROM numeradores WHERE clave='comprobante_interno'").first<{ultimo:number}>())?.ultimo)+1
    if(!Number.isSafeInteger(n)||n<1)throw new ErrorDocumento('Revisá el numerador del comprobante.',409)
    const contenido=pdf(['Comprobante interno',`N.º ${numeroTexto(n)} · Fecha: ${fecha}`, '',prof.nombre,prof.especialidad??'',`Matrícula: ${prof.matricula}`,...(prof.cuit?[`CUIT: ${prof.cuit}`]:[]),prof.domicilio_fiscal??'','',`Recibí de: ${r.nombre}`,`${r.tipo.toUpperCase()}: ${r.doc}`,'',`Concepto: ${pago.concepto}`,`Pago del ${pago.fecha} · ${MEDIOS[pago.medio]??pago.medio}`,`Importe recibido: ${importeTexto(pago.importe)}`,'',prof.comprobante_pie??'','Documento no válido como factura'],fuenteBytes,{color:prof.comprobante_color??COLORES[0][2],logo})
    const hash=await sha256(contenido),clave=`comprobantes/${crypto.randomUUID()}.pdf`
    let subido=false,persistido=false,conservarPorDuda=false
    try {
      await env.ARCHIVOS.put(clave,contenido,{httpMetadata:{contentType:'application/pdf'}});subido=true
      const lote=await env.DB.batch([
        env.DB.prepare(`UPDATE numeradores SET ultimo=ultimo+1 WHERE clave='comprobante_interno' AND ultimo=?
          AND EXISTS(SELECT 1 ${origen} WHERE ${vigente}) AND NOT EXISTS(SELECT 1 FROM comprobantes WHERE pago_id=? AND tipo IN ('interno','factura_c'))`).bind(n-1,pagoId,pagoId),
        env.DB.prepare(`INSERT INTO comprobantes(pago_id,tipo,numero,receptor_nombre,receptor_doc_tipo,receptor_doc,importe,fecha,estado,pdf_clave,pdf_sha256,foto)
          SELECT p.id,'interno',?,?,?, ?,p.importe,?,'emitido',?,?,? ${origen} WHERE ${vigente}
          AND (SELECT ultimo FROM numeradores WHERE clave='comprobante_interno')=?
          AND NOT EXISTS(SELECT 1 FROM comprobantes WHERE pago_id=? AND tipo IN ('interno','factura_c'))
          AND NOT EXISTS(SELECT 1 FROM comprobantes WHERE tipo='interno' AND numero=?)`).bind(n,r.nombre,r.tipo,r.doc,fecha,clave,hash,JSON.stringify(foto),pagoId,n,pagoId,n),
        env.DB.prepare(`INSERT INTO auditoria(evento,detalle,usuario) SELECT 'comprobante_emitido','comprobante:'||id,? FROM comprobantes WHERE pdf_clave=?`).bind(usuario,clave),
      ])
      const creado=await porPago(env.DB,pagoId)
      persistido=creado?.pdf_clave===clave
      if(creado)return creado
      if(lote[0].meta.changes)throw new ErrorDocumento('No se pudo registrar el comprobante. Revisá el numerador.',409)
      const actual=await leerPago(env.DB,pagoId)
      if(!actual||actual.anulado_en||actual.cobro_anulado||actual.perdonado_en||actual.baja_en)throw new ErrorDocumento('El pago, el cobro o la ficha pasó a solo lectura. No se emitió.',409)
    } catch(e) {
      // Si la respuesta de D1 se cortó después de confirmar, no borrar su PDF ni consumir otro número.
      let confirmado:Comprobante|null
      try{confirmado=await porPago(env.DB,pagoId)}catch{conservarPorDuda=true;throw e}
      persistido=confirmado?.pdf_clave===clave
      if(confirmado)return confirmado
      throw e
    } finally {if(subido&&!persistido&&!conservarPorDuda)await env.ARCHIVOS.delete(clave)}
  }
  throw new ErrorDocumento('Se emitieron otros comprobantes al mismo tiempo. Volvé a intentar.',409)
}
