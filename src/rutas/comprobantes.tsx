// X4 · Comprobante interno y Configuración → Cobros y comprobantes.
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Child } from 'hono/jsx'
import type { C, Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { ahoraISO } from '../lib/fechas'
import { ErrorDocumento, numero, sha256 } from '../lib/documentos'
import { COLORES, CAMPOS, MEDIOS, imagen, archivoImagen, claseColor, configurar, emitir, importeTexto, leerComprobante, leerPago, leerPerfil, numeroTexto, type Comprobante, type FotoComprobante, type PerfilCobros } from '../lib/comprobantes'
import { SECCIONES } from './configuracion'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Campo, Interruptor, Opciones, Tarjeta } from '../ui/componentes'
import { PorCorreo } from './envios'

export const comprobantes=new Hono<Env>()
const CFG='/configuracion/cobros'
async function pagina(c:C,titulo:string,hijos:Child,status:200|400|404|409|422=200,seccion:'cobros'|'configuracion'='cobros') {
  const p=await leerPerfil(c.env.DB)
  return c.html(<Pagina titulo={titulo} seccion={seccion} inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={p?.nombre}>{hijos}</Pagina>,status)
}
const seguro=(accion:(c:C)=>Promise<Response>)=>async(c:C)=>{
  try{return await accion(c)}catch(e){if(!(e instanceof ErrorDocumento))throw e;return pagina(c,'Revisá el comprobante',<><Aviso tipo="error">{e.message}</Aviso><p>Volvé a la pantalla anterior para revisar los datos. El pago sigue registrado.</p><div class="fila"><Boton href="/cobros">Ver cobros</Boton><Boton href={CFG}>Configuración</Boton></div></>,e.estado)}
}
async function auditar(c:C,evento:string,detalle:string){await c.env.DB.prepare('INSERT INTO auditoria(evento,detalle,usuario) VALUES (?,?,?)').bind(evento,detalle,c.get('email')!).run()}
function Vista({foto,numero:n,fecha,importe,logo,ejemplo=false}: {foto:FotoComprobante;numero:number;fecha:string;importe:number;logo?:string;ejemplo?:boolean}) {
  const p=foto.profesional,r=foto.receptor
  return <section class={`comp-papel columna ${claseColor(p.comprobante_color)}`} aria-label={ejemplo?'Vista previa del diseño':'Vista previa del comprobante'} data-comp-previa="">
    <header class="comp-cabecera fila"><div class="columna-chica comp-identidad"><img src={logo} class="comp-logo" alt="Logo del comprobante" hidden={!logo} data-comp-logo="" /><strong>{p.nombre||'Tu nombre'}</strong><span>{p.especialidad}</span><span>Matrícula {p.matricula||'Sin completar'}</span>{p.cuit&&<span>CUIT {p.cuit}</span>}{p.domicilio_fiscal&&<span>{p.domicilio_fiscal}</span>}</div><div class="columna-chica"><strong>Comprobante interno</strong><span>N.º {ejemplo?'—':numeroTexto(n)}</span><span>{fecha}</span></div></header>
    {ejemplo&&<p class="aviso">Ejemplo de diseño · no emitido</p>}
    <div class="columna-chica"><span class="ayuda">Recibí de</span><strong>{r.nombre}</strong><span>{r.tipo.toUpperCase()} {r.doc}</span></div>
    <div class="comp-concepto"><strong>{foto.pago.concepto}</strong><span>{importeTexto(importe)}</span></div><p>Pagó por {MEDIOS[foto.pago.medio]??foto.pago.medio} el {foto.pago.fecha}.</p>
    <p class="comp-pie" data-comp-pie="">{p.comprobante_pie}</p><p class="ayuda">Documento no válido como factura</p>
  </section>
}
const ejemplo=(p:PerfilCobros):FotoComprobante=>({profesional:p,pago:{id:0,cobro_id:0,importe:1200000,medio:'efectivo',fecha:'—',anulado_en:null,paciente_id:0,nombre:'Paciente',apellido:'de ejemplo',dni:'00000000',celular:'',concepto:'Consulta de ejemplo',cobro_anulado:null,perdonado_en:null,baja_en:null},receptor:{nombre:'Paciente de ejemplo',tipo:'dni',doc:'00000000'},logo_sha256:null,emitido_por:''})
async function configuracion(c:C,error?:string,form?:FormData) {
  const p=(await leerPerfil(c.env.DB))!,v=(k:keyof PerfilCobros)=>form&&typeof form.get(k)==='string'?String(form.get(k)):String(p[k]??'')
  const color=v('comprobante_color')||COLORES[0][2],preview=ejemplo({...p,comprobante_color:color,comprobante_pie:v('comprobante_pie')})
  const campo=(k:keyof PerfilCobros,etiqueta:string,tipo:'text'|'number'|'email'='text')=><Campo nombre={k} etiqueta={etiqueta} valor={v(k)} tipo={tipo} />
  return pagina(c,'Configuración',<div class="config-layout"><aside class="columna"><h1>Configuración</h1><nav class="config-menu" aria-label="Secciones de configuración">{SECCIONES.map(([id,titulo,sub])=><a href={`/configuracion/${id}`} aria-current={id==='cobros'?'page':undefined} data-modulo={id==='cobros'?'cobros':id==='recordatorios'?'agenda':undefined}><strong>{titulo}</strong><span class="ayuda">{sub}</span></a>)}</nav></aside><div class="config-contenido columna">
    {error&&<Aviso tipo="error">{error}</Aviso>}{!error&&c.req.query('guardado')==='1'&&<Aviso tipo="ok">Guardaste los cambios.</Aviso>}
    <form class="columna" method="post" action={CFG} enctype="multipart/form-data" data-comp-config="">
      <Tarjeta titulo="Datos fiscales"><p class="ayuda">Se usarán para factura C en la etapa 4. Podés emitir el comprobante interno sin datos fiscales.</p><div class="config-campos">{campo('cuit','CUIT')}<label class="campo">Condición frente al IVA<select class="entrada" name="condicion_iva"><option value="" selected={!v('condicion_iva')}>Sin completar</option><option value="monotributo" selected={v('condicion_iva')==='monotributo'}>Monotributista</option><option value="exento" selected={v('condicion_iva')==='exento'}>Exento</option></select></label>{campo('domicilio_fiscal','Domicilio fiscal')}{campo('punto_venta','Punto de venta','number')}</div><Aviso>Estado de ARCA: {({sin_configurar:'sin configurar',homologacion:'homologación',produccion:'producción'} as Record<string,string>)[p.arca_estado]??'sin configurar'}. El certificado lo carga BC Informática. La factura C llega en la etapa 4.</Aviso></Tarjeta>
      <Tarjeta titulo="Datos para que te transfieran"><p class="ayuda">La app no mueve plata ni guarda claves de tu cuenta.</p><div class="config-campos">{campo('transferencia_alias','Alias')}{campo('transferencia_cbu','CBU o CVU')}{campo('transferencia_titular','Titular')}</div>{p.transferencia_qr_clave&&<><img class="comp-qr" src={`${CFG}/imagen/qr`} alt="QR de transferencia cargado" /><label class="config-casilla"><input type="checkbox" name="quitar_qr" value="1" />Quitar QR</label></>}<label class="campo">Imagen del QR de tu banco o billetera<input class="entrada" type="file" name="qr" accept="image/png,image/jpeg" /></label><p class="ayuda">Opcional. JPG o PNG, hasta 2 MB y un millón de píxeles.</p></Tarjeta>
      <Tarjeta titulo="Tu comprobante interno"><div class="comp-diseno"><div class="columna"><label class="campo">Logo del comprobante<input class="entrada" type="file" name="logo" accept="image/png,image/jpeg" data-comp-logo-input="" /></label><p class="ayuda">JPG o PNG, hasta 2 MB y un millón de píxeles.</p>{p.comprobante_logo_clave&&<label class="config-casilla"><input type="checkbox" name="quitar_logo" value="1" />Quitar logo</label>}<fieldset class="campo"><legend>Color del comprobante</legend><div class="fila">{COLORES.map(([id,nombre,hex])=><label class={`pastilla comp-muestra comp-${id}`}><input type="radio" name="comprobante_color" value={hex} data-comp-color={id} checked={color.toLowerCase()===hex.toLowerCase()} />{nombre}</label>)}</div></fieldset>{campo('comprobante_pie','Pie del comprobante')}</div><Vista foto={preview} numero={0} fecha="—" importe={1200000} logo={p.comprobante_logo_clave?`${CFG}/imagen/logo`:undefined} ejemplo /></div></Tarjeta>
      <Tarjeta titulo="Contadora y ausencias">{campo('correo_contadora','Correo de tu contadora','email')}<Interruptor etiqueta="Cobrar cuando el paciente no viene" nombre="cobro_ausencia_activo" marcado={form?form.get('cobro_ausencia_activo')==='1':!!p.cobro_ausencia_activo} />{campo('cobro_ausencia_horas','Horas de anticipación','number')}<p class="ayuda">Apagado por defecto. Esta preferencia no carga cobros por sí sola.</p><div class="config-pie"><Boton type="submit" variante="oscuro">Guardar cambios</Boton></div></Tarjeta>
    </form>
  </div></div>,error?422:200,'configuracion')
}
// Configuración también respeta el módulo aunque su URL quede fuera de /comprobantes.
comprobantes.use('/configuracion/cobros/*',async(c,next)=>leerInstalacion(c.env).modulos.has('cobros')?next():c.notFound())
comprobantes.use(CFG,async(c,next)=>leerInstalacion(c.env).modulos.has('cobros')?next():c.notFound())
comprobantes.get(CFG,c=>configuracion(c))
comprobantes.use(CFG,bodyLimit({maxSize:5*1024*1024,onError:c=>c.text('Las imágenes pueden pesar hasta 2 MB cada una.',413)}))
comprobantes.post(CFG,async c=>{
  const form=await c.req.formData(),creados:string[]=[]
  let persistido=false
  try {
    const datos=configurar(form),[logo,qr]=await Promise.all([archivoImagen(form,'logo'),archivoImagen(form,'qr')])
    if((logo&&form.get('quitar_logo')==='1')||(qr&&form.get('quitar_qr')==='1'))throw new ErrorDocumento('Elegí cambiar o quitar cada imagen, no ambas opciones.')
    const viejo=(await leerPerfil(c.env.DB))!
    const subir=async(a:Awaited<ReturnType<typeof archivoImagen>>,tipo:string,vieja:string|null,quitar:boolean)=>{
      if(!a)return quitar?null:vieja
      const clave=`configuracion/cobros/${tipo}/${crypto.randomUUID()}`
      await c.env.ARCHIVOS.put(clave,a.bytes,{httpMetadata:{contentType:a.mime}});creados.push(clave);return clave
    }
    const logoClave=await subir(logo,'logo',viejo.comprobante_logo_clave,form.get('quitar_logo')==='1'),qrClave=await subir(qr,'qr',viejo.transferencia_qr_clave,form.get('quitar_qr')==='1')
    persistido=true // Ante un corte de D1 con resultado desconocido, conservar las imágenes originales.
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE profesional SET ${CAMPOS.map(k=>`${k}=?`).join(',')},comprobante_logo_clave=?,transferencia_qr_clave=?,actualizado_en=? WHERE id=1`).bind(...CAMPOS.map(k=>datos[k]),logoClave,qrClave,ahoraISO()),
      c.env.DB.prepare("INSERT INTO auditoria(evento,usuario) VALUES ('configuracion_cobros_guardada',?)").bind(c.get('email')!),
    ])
    persistido=true
    // Se conservan logos anteriores: los comprobantes emitidos siguen apuntando a sus originales.
    return c.redirect(`${CFG}?guardado=1`,303)
  }catch(e){if(e instanceof ErrorDocumento)return configuracion(c,e.message,form);throw e}
  finally{if(!persistido)for(const clave of creados)await c.env.ARCHIVOS.delete(clave)}
})
comprobantes.get(`${CFG}/imagen/:tipo`,seguro(async c=>{
  const tipo=c.req.param('tipo'),p=(await leerPerfil(c.env.DB))!,clave=tipo==='qr'?p.transferencia_qr_clave:tipo==='logo'?p.comprobante_logo_clave:null
  if(!clave)return c.notFound()
  const obj=await c.env.ARCHIVOS.get(clave);if(!obj)return c.notFound()
  const b=new Uint8Array(await obj.arrayBuffer());await imagen(b)
  c.header('Content-Type',b[0]===255?'image/jpeg':'image/png');c.header('Cache-Control','private, no-store');c.header('X-Content-Type-Options','nosniff');return c.body(b.buffer)
}))

comprobantes.get('/comprobantes/nuevo',seguro(async c=>{
  const id=numero(c.req.query('pago')),p=await leerPago(c.env.DB,id)
  if(!p)return c.notFound()
  const anterior=await c.env.DB.prepare("SELECT id FROM comprobantes WHERE pago_id=? AND tipo IN ('interno','factura_c')").bind(id).first<{id:number}>()
  if(anterior)return c.redirect(`/comprobantes/${anterior.id}`,303)
  if(p.anulado_en||p.cobro_anulado||p.perdonado_en||p.baja_en)throw new ErrorDocumento('El pago, el cobro o la ficha está en solo lectura.',409)
  return pagina(c,'Comprobante',<><div class="comp-titulo"><h1>Comprobante</h1><p>{p.nombre} {p.apellido} · {p.concepto} · pagó {importeTexto(p.importe)} por {MEDIOS[p.medio]}</p><p class="ayuda">Paso 3 de Cobrar · El pago ya quedó guardado.</p></div><div class="comp-armado"><Tarjeta titulo="¿Qué comprobante hacés?"><form method="post" action="/comprobantes/emitir" class="columna" data-comp-emitir=""><input type="hidden" name="pago" value={id} /><fieldset class="campo"><legend>Tipo de comprobante</legend><div class="fila"><label class="pastilla"><input type="radio" name="tipo" value="interno" checked />Comprobante interno</label><label class="pastilla"><input type="radio" name="tipo" value="factura_c" disabled />Factura C · llega en la etapa 4</label></div></fieldset><Opciones leyenda="A nombre de" nombre="receptor" elegida="paciente" opciones={[{valor:'paciente',texto:`${p.nombre} ${p.apellido} (paciente)`},{valor:'otra',texto:'Otra persona'}]} /><div class="columna" data-comp-otra=""><Campo etiqueta="Nombre y apellido del receptor" nombre="receptor_nombre" /><label class="campo">Tipo de documento<select class="entrada" name="receptor_doc_tipo"><option value="dni">DNI</option><option value="cuit">CUIT</option></select></label><Campo etiqueta="DNI o CUIT del receptor" nombre="receptor_doc" /></div><p class="ayuda">El número se asigna al emitir. No es una factura fiscal.</p><div class="fila"><Boton type="submit" variante="oscuro">Emitir comprobante interno</Boton><Boton href="/cobros">Ahora no</Boton></div></form></Tarjeta><Tarjeta titulo="El pago que vas a documentar"><p>{p.concepto}</p><p>Importe recibido: <strong>{importeTexto(p.importe)}</strong></p><p>Paciente: {p.nombre} {p.apellido} · DNI {p.dni}</p><p>Fecha de pago: {p.fecha}</p></Tarjeta></div></>)
}))
comprobantes.post('/comprobantes/emitir',seguro(async c=>{
  const f=await c.req.formData(),r=await emitir(c.env,numero(f.get('pago')),f,c.get('email')!)
  return c.redirect(`/comprobantes/${r.id}`,303)
}))
async function original(c:C,r:Comprobante) {
  if(!r.pdf_clave||!r.pdf_sha256)throw new ErrorDocumento('No encontramos el PDF original.',404)
  const obj=await c.env.ARCHIVOS.get(r.pdf_clave);if(!obj)throw new ErrorDocumento('No encontramos el PDF original.',404)
  const b=new Uint8Array(await obj.arrayBuffer());if(await sha256(b)!==r.pdf_sha256)throw new ErrorDocumento('La huella del PDF no coincide. No se entregó el archivo.',409)
  return b
}
comprobantes.get('/comprobantes/:id{[0-9]+}/pdf',seguro(async c=>{
  const r=await leerComprobante(c.env.DB,numero(c.req.param('id')));if(!r)return c.notFound()
  const b=await original(c,r)
  await auditar(c,'comprobante_descargado',`comprobante:${r.id}`)
  c.header('Content-Type','application/pdf');c.header('Content-Disposition',`${c.req.query('ver')==='1'?'inline':'attachment'}; filename="comprobante_${numeroTexto(r.numero)}.pdf"`);c.header('Cache-Control','private, no-store');c.header('X-Content-Type-Options','nosniff');return c.body(b.buffer)
}))
comprobantes.get('/comprobantes/:id{[0-9]+}/logo',seguro(async c=>{
  const r=await leerComprobante(c.env.DB,numero(c.req.param('id')));if(!r)return c.notFound()
  const foto=JSON.parse(r.foto) as FotoComprobante,clave=foto.profesional?.comprobante_logo_clave
  if(!clave||!foto.logo_sha256)return c.notFound()
  const obj=await c.env.ARCHIVOS.get(clave);if(!obj)return c.notFound()
  const b=new Uint8Array(await obj.arrayBuffer());if(await sha256(b)!==foto.logo_sha256)throw new ErrorDocumento('La huella del logo original no coincide.',409)
  c.header('Content-Type',b[0]===255?'image/jpeg':'image/png');c.header('Cache-Control','private, no-store');c.header('X-Content-Type-Options','nosniff');return c.body(b.buffer)
}))
comprobantes.get('/comprobantes/:id{[0-9]+}',seguro(async c=>{
  const r=await leerComprobante(c.env.DB,numero(c.req.param('id')));if(!r)return c.notFound()
  const p=await leerPago(c.env.DB,r.pago_id);if(!p)return c.notFound()
  const foto=JSON.parse(r.foto) as FotoComprobante
  const correo=(await c.env.DB.prepare('SELECT correo FROM pacientes WHERE id=?').bind(p.paciente_id).first<{correo:string|null}>())?.correo??null
  const mensaje=`Hola ${p.nombre}, te adjunto el comprobante interno N.º ${numeroTexto(r.numero)} por ${importeTexto(r.importe)}.`,cel=p.celular.replace(/\D/g,'')
  return pagina(c,'Comprobante interno',<><a class="volver" href="/cobros">← Volver a Cobros</a><div class="comp-armado"><Tarjeta titulo={`Comprobante interno N.º ${numeroTexto(r.numero)}`}>
    {r.estado==='anulado'?<Aviso tipo="error">Anulado el {r.anulado_en}: {r.anulado_motivo}. El PDF original se conserva.</Aviso>:<Aviso tipo="ok">Comprobante emitido</Aviso>}
    <p>{r.receptor_nombre} · {r.receptor_doc_tipo.toUpperCase()} {r.receptor_doc}</p><p>Importe recibido: {importeTexto(r.importe)}</p>
    <div class="fila"><Boton href={`/comprobantes/${r.id}/pdf`}>Descargar PDF</Boton><a class="boton borde" href={`/comprobantes/${r.id}/pdf?ver=1`} target="_blank" rel="noopener">Ver PDF original</a></div>
    {r.estado==='emitido'&&!p.anulado_en&&<><h3>¿Se lo mandás?</h3><div class="fila"><a class="boton oscuro" href={`https://wa.me/${cel.length===10?'549'+cel:cel}?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener">Por WhatsApp</a><PorCorreo env={c.env} accion={`/comprobantes/${r.id}/correo`} correo={correo} volver={`/comprobantes/${r.id}`} /></div><p class="ayuda">Por WhatsApp, descargá el PDF y adjuntalo. Nada sale solo.</p>
      {!p.baja_en&&<details><summary class="boton texto">Anular el pago</summary><p>Se anula el pago y el comprobante queda anulado con el mismo motivo.</p><form class="columna" method="post" action={`/pagos/${p.id}/anular`}><Campo etiqueta="Motivo de anulación" nombre="motivo" requerido /><Boton type="submit" variante="peligro">Anular pago y comprobante</Boton></form></details>}</>}
  </Tarjeta>{foto.profesional?<Vista foto={foto} numero={r.numero} fecha={r.fecha} importe={r.importe} logo={foto.profesional.comprobante_logo_clave?`/comprobantes/${r.id}/logo`:undefined} />:<Aviso>La vista histórica está en el PDF original.</Aviso>}</div></>)
}))
