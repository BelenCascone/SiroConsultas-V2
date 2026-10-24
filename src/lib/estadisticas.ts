// X5 · Lecturas agregadas: no se cargan notas clínicas ni se modifican registros.
import { ahoraAR, esFecha, MESES, sumarDias } from './fechas'

export class FiltroInvalido extends Error {}
export type Filtros = { periodo: 'mes'|'anterior'|'trimestre'|'fechas'; desde:string;hasta:string;anteriorDesde:string;anteriorHasta:string;consultorio:number|null;mes:string;tabla:boolean;hoy:string }
export const inicioMes=(s:string)=>s.slice(0,7)+'-01'
export function desplazarMes(s:string,n:number) {
  const d=new Date(inicioMes(s)+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n)
  return d.toISOString().slice(0,10)
}
export const finMes=(s:string)=>sumarDias(desplazarMes(s,1),-1)
export const nombreMes=(s:string)=>`${MESES[Number(s.slice(5,7))-1]} ${s.slice(0,4)}`
export const fechaCorta=(s:string)=>`${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`
export const porcentaje=(n:number,total:number)=>total?Math.round(n*100/total):0
export function leerFiltros(q:Record<string,string>,hoy=ahoraAR().fecha):Filtros {
  const periodo=q.periodo??'mes'
  if(!['mes','anterior','trimestre','fechas'].includes(periodo))throw new FiltroInvalido('Elegí un período válido.')
  let desde=inicioMes(hoy),hasta=finMes(hoy),anteriorDesde=desplazarMes(hoy,-1),anteriorHasta=finMes(anteriorDesde)
  if(periodo==='anterior'){desde=anteriorDesde;hasta=anteriorHasta;anteriorDesde=desplazarMes(desde,-1);anteriorHasta=finMes(anteriorDesde)}
  if(periodo==='trimestre'){
    const inicioTrimestre=hoy.slice(0,4)+'-'+String(Math.floor((Number(hoy.slice(5,7))-1)/3)*3+1).padStart(2,'0')+'-01'
    desde=desplazarMes(inicioTrimestre,-3);hasta=sumarDias(inicioTrimestre,-1);anteriorDesde=desplazarMes(desde,-3);anteriorHasta=sumarDias(desde,-1)
  }
  if(periodo==='fechas'){
    desde=q.desde??desde;hasta=q.hasta??hasta
    if(!esFecha(desde)||!esFecha(hasta)||desde<'0001-01-01'||hasta>'9999-12-31'||hasta<desde)throw new FiltroInvalido('Revisá desde y hasta: deben ser fechas reales, en ese orden.')
    const dias=Math.round((Date.parse(hasta+'T00:00:00Z')-Date.parse(desde+'T00:00:00Z'))/86400000)+1
    anteriorHasta=sumarDias(desde,-1);anteriorDesde=sumarDias(desde,-dias)
    if(!esFecha(anteriorDesde))throw new FiltroInvalido('El rango es demasiado amplio para comparar con el período anterior.')
  }
  let consultorio:number|null=null
  if(q.consultorio==='sin')consultorio=0
  else if(q.consultorio&&q.consultorio!=='todos'){
    if(!/^\d+$/.test(q.consultorio)||!Number.isSafeInteger(Number(q.consultorio))||Number(q.consultorio)<1)throw new FiltroInvalido('Elegí un consultorio válido.')
    consultorio=Number(q.consultorio)
  }
  if(q.mes&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.mes))throw new FiltroInvalido('Revisá el mes del gráfico.')
  const visibles=Array.from({length:6},(_,i)=>desplazarMes(hoy,i-5).slice(0,7))
  const mes=q.mes&&visibles.includes(q.mes)?q.mes:visibles.includes(hasta.slice(0,7))?hasta.slice(0,7):visibles[5]
  return {periodo:periodo as Filtros['periodo'],desde,hasta,anteriorDesde,anteriorHasta,consultorio,mes,tabla:q.tabla==='1',hoy}
}
export function enlace(f:Filtros,cambios:Record<string,string>={},ancla='') {
  const q=new URLSearchParams({periodo:f.periodo,consultorio:f.consultorio===null?'todos':f.consultorio===0?'sin':String(f.consultorio),mes:f.mes})
  if(f.periodo==='fechas'){q.set('desde',f.desde);q.set('hasta',f.hasta)}
  if(f.tabla)q.set('tabla','1')
  for(const[k,v]of Object.entries(cambios))v?q.set(k,v):q.delete(k)
  return `/estadisticas?${q}${ancla?'#'+ancla:''}`
}

// Un turno atendido y su consulta se cuentan una vez. Las consultas firmadas sin turno también cuentan.
// Se clasifica la primera atención registrada ANTES de filtrar por fechas o consultorio.
const ATENCIONES=`WITH historia AS (
  SELECT 't:'||t.id clave,t.id orden,t.paciente_id,t.fecha,t.hora,t.consultorio_id,t.prestacion_id,t.cobertura,t.obra_social_id,t.modalidad
    FROM turnos t WHERE t.estado='atendido'
  UNION ALL
  SELECT 'c:'||c.id clave,c.id orden,c.paciente_id,date(c.finalizada_en,'-3 hours') fecha,strftime('%H:%M',c.finalizada_en,'-3 hours') hora,
    COALESCE(c.consultorio_id,t.consultorio_id),t.prestacion_id,
    COALESCE(CASE WHEN json_valid(c.foto) THEN json_extract(c.foto,'$.paciente.cobertura') END,t.cobertura),
    COALESCE(CASE WHEN json_valid(c.foto) THEN json_extract(c.foto,'$.paciente.obra_social_id') END,t.obra_social_id),COALESCE(t.modalidad,co.modalidad)
    FROM consultas c LEFT JOIN turnos t ON t.id=c.turno_id LEFT JOIN consultorios co ON co.id=c.consultorio_id
    WHERE c.estado='finalizada' AND (c.turno_id IS NULL OR t.estado<>'atendido')
), atenciones AS (
  SELECT *,CASE WHEN ROW_NUMBER() OVER(PARTITION BY paciente_id ORDER BY fecha,hora,orden,clave)=1 THEN 1 ELSE 0 END primera FROM historia
)`
const FILTRO='fecha BETWEEN ? AND ? AND (? IS NULL OR COALESCE(consultorio_id,0)=?)'
export type Grupo={id:string|number|null;nombre:string;n:number}
export type Mes={mes:string;primera:number;vuelven:number;total:number}
export type Prestacion={id:string|number;nombre:string;consultas:number;cobrado:number;pagos:number;promedio:number}
export type Finanzas={cobrado:number;pagos:number;particulares:number;copagos:number;deben:number;ticket:number;facturado:number;interno:number;sinComprobante:number;medios:Grupo[];prestaciones:Prestacion[]}
export type Estadisticas={consultas:number;primera:number;vuelven:number;anteriores:number;ausencias:number;canceladosPaciente:number;canceladosProfesional:number;canceladosSistema:number;meses:Mes[];coberturas:Grupo[];consultorios:Grupo[];modalidades:Grupo[];finanzas:Finanzas|null}
type Resumen={consultas:number;primera:number}
export async function leerEstadisticas(db:D1Database,f:Filtros,cobros:boolean):Promise<Estadisticas> {
  const args=[f.desde,f.hasta,f.consultorio,f.consultorio],antes=[f.anteriorDesde,f.anteriorHasta,f.consultorio,f.consultorio]
  // D1 ejecuta las lecturas en una misma transacción: los desgloses y los totales comparten foto.
  const lecturas=await db.batch<Record<string,unknown>>([
    db.prepare(`${ATENCIONES} SELECT COUNT(*) consultas,COALESCE(SUM(primera),0) primera FROM atenciones WHERE ${FILTRO}`).bind(...args),
    db.prepare(`${ATENCIONES} SELECT COUNT(*) consultas FROM atenciones WHERE ${FILTRO}`).bind(...antes),
    db.prepare(`SELECT COALESCE(SUM(estado='ausente'),0) ausencias,COALESCE(SUM(estado='cancelado' AND cancelado_por='paciente'),0) paciente,
      COALESCE(SUM(estado='cancelado' AND cancelado_por='profesional'),0) profesional,COALESCE(SUM(estado='cancelado' AND cancelado_por='sistema'),0) sistema
      FROM turnos WHERE ${FILTRO}`).bind(...args),
    (db.prepare(`${ATENCIONES} SELECT substr(fecha,1,7) mes,SUM(primera) primera,COUNT(*) total FROM atenciones WHERE ${FILTRO} GROUP BY mes`).bind(desplazarMes(f.hoy,-5),finMes(f.hoy),f.consultorio,f.consultorio)),
    (db.prepare(`${ATENCIONES} SELECT CASE WHEN a.cobertura='obra_social' THEN 'os:'||COALESCE(a.obra_social_id,0) ELSE COALESCE(a.cobertura,'sin') END id,
      CASE WHEN a.cobertura='obra_social' THEN COALESCE(o.nombre,'Obra social sin identificar') WHEN a.cobertura='particular' THEN 'Particular' ELSE 'Sin cobertura registrada' END nombre,COUNT(*) n
      FROM atenciones a LEFT JOIN obras_sociales o ON o.id=a.obra_social_id WHERE a.${FILTRO} GROUP BY 1 ORDER BY n DESC,nombre`).bind(...args)),
    (db.prepare(`${ATENCIONES} SELECT COALESCE(a.consultorio_id,0) id,COALESCE(co.nombre,'Sin consultorio') nombre,COUNT(*) n
      FROM atenciones a LEFT JOIN consultorios co ON co.id=a.consultorio_id WHERE a.${FILTRO} GROUP BY a.consultorio_id ORDER BY n DESC,nombre`).bind(...args)),
    (db.prepare(`${ATENCIONES} SELECT modalidad id,CASE modalidad WHEN 'videollamada' THEN 'Videollamada' WHEN 'presencial' THEN 'Presencial' ELSE 'Sin modalidad registrada' END nombre,COUNT(*) n FROM atenciones WHERE ${FILTRO} GROUP BY modalidad ORDER BY n DESC,nombre`).bind(...args)),
    ...(cobros?consultasFinanzas(db,f):[]),
  ])
  const [res,previo,turnos]=lecturas.slice(0,3).map(r=>r.results[0]) as [Resumen,{consultas:number},{ausencias:number;paciente:number;profesional:number;sistema:number}]
  const meses=lecturas[3].results as unknown as {mes:string;primera:number;total:number}[]
  const [coberturas,consultorios,modalidades]=lecturas.slice(4,7).map(r=>r.results) as unknown as [Grupo[],Grupo[],Grupo[]]
  const finanzas=cobros?finanzasDeLectura(lecturas.slice(7)):null
  const historia=Array.from({length:6},(_,i)=>{const mes=desplazarMes(f.hoy,i-5).slice(0,7),m=meses.find(x=>x.mes===mes);return {mes,primera:m?.primera??0,vuelven:(m?.total??0)-(m?.primera??0),total:m?.total??0}})
  return {consultas:res?.consultas??0,primera:res?.primera??0,vuelven:(res?.consultas??0)-(res?.primera??0),anteriores:previo?.consultas??0,ausencias:turnos?.ausencias??0,canceladosPaciente:turnos?.paciente??0,canceladosProfesional:turnos?.profesional??0,canceladosSistema:turnos?.sistema??0,meses:historia,coberturas,consultorios,modalidades,finanzas}
}
const PAGOS=`WITH cobrados AS (
  SELECT p.id,p.importe,p.medio,p.fecha,c.cobertura,c.consultorio_id,c.prestacion_id,
    CASE WHEN EXISTS(SELECT 1 FROM comprobantes cp WHERE cp.pago_id=p.id AND cp.tipo='factura_c' AND cp.estado='emitido'
      AND NOT EXISTS(SELECT 1 FROM comprobantes nc WHERE nc.asociado_id=cp.id AND nc.tipo='nota_credito_c' AND nc.estado='emitido')) THEN 'factura'
      WHEN EXISTS(SELECT 1 FROM comprobantes cp WHERE cp.pago_id=p.id AND cp.tipo='interno' AND cp.estado='emitido') THEN 'interno' ELSE 'sin' END comprobante
    FROM pagos p JOIN cobros c ON c.id=p.cobro_id WHERE p.anulado_en IS NULL
)`
function consultasFinanzas(db:D1Database,f:Filtros):D1PreparedStatement[] {
  const args=[f.desde,f.hasta,f.consultorio,f.consultorio]
  return [
    db.prepare(`${PAGOS} SELECT COALESCE(SUM(importe),0) cobrado,COUNT(*) pagos,COALESCE(SUM(CASE WHEN cobertura='particular' THEN importe ELSE 0 END),0) particulares,
      COALESCE(SUM(CASE WHEN cobertura='obra_social' THEN importe ELSE 0 END),0) copagos,
      COALESCE(SUM(CASE WHEN comprobante='factura' THEN importe ELSE 0 END),0) facturado,COALESCE(SUM(CASE WHEN comprobante='interno' THEN importe ELSE 0 END),0) interno,
      COALESCE(SUM(CASE WHEN comprobante='sin' THEN importe ELSE 0 END),0) sinComprobante FROM cobrados WHERE ${FILTRO}`).bind(...args),
    db.prepare(`SELECT COALESCE((SELECT SUM(saldo) FROM v_cobros WHERE (? IS NULL OR COALESCE(consultorio_id,0)=?)),0)
      +COALESCE((SELECT SUM(CASE WHEN t.cobertura='obra_social' THEN 0 ELSE COALESCE(pr.importe,0) END) FROM turnos t LEFT JOIN prestaciones pr ON pr.id=t.prestacion_id
        WHERE t.estado='atendido' AND (? IS NULL OR t.consultorio_id=?) AND NOT EXISTS(SELECT 1 FROM cobros c WHERE c.turno_id=t.id AND c.anulado_en IS NULL)),0) deben`).bind(f.consultorio,f.consultorio,f.consultorio,f.consultorio),
    (db.prepare(`${PAGOS} SELECT medio id,CASE medio WHEN 'efectivo' THEN 'Efectivo' WHEN 'transferencia' THEN 'Transferencia' WHEN 'tarjeta' THEN 'Tarjeta' ELSE 'Otro' END nombre,SUM(importe) n FROM cobrados WHERE ${FILTRO} GROUP BY medio ORDER BY n DESC,nombre`).bind(...args)),
    (db.prepare(`${ATENCIONES}, por_prestacion AS (
      SELECT prestacion_id,COUNT(*) consultas,0 cobrado,0 pagos FROM atenciones WHERE ${FILTRO} GROUP BY prestacion_id
      UNION ALL
      SELECT c.prestacion_id,0,SUM(p.importe),COUNT(*) FROM pagos p JOIN cobros c ON c.id=p.cobro_id
        WHERE p.anulado_en IS NULL AND p.fecha BETWEEN ? AND ? AND (? IS NULL OR COALESCE(c.consultorio_id,0)=?) GROUP BY c.prestacion_id)
      SELECT COALESCE(g.prestacion_id,0) id,COALESCE(pr.nombre,'Sin prestación') nombre,SUM(g.consultas) consultas,SUM(g.cobrado) cobrado,SUM(g.pagos) pagos
      FROM por_prestacion g LEFT JOIN prestaciones pr ON pr.id=g.prestacion_id GROUP BY g.prestacion_id ORDER BY cobrado DESC,nombre`).bind(...args,...args)),
  ]
}
function finanzasDeLectura(lecturas:D1Result<Record<string,unknown>>[]):Finanzas {
  const r=lecturas[0].results[0] as unknown as Omit<Finanzas,'medios'|'prestaciones'|'deben'|'ticket'>
  const deuda=lecturas[1].results[0] as unknown as {deben:number}
  const medios=lecturas[2].results as unknown as Grupo[]
  const prestaciones=lecturas[3].results as unknown as {id:string;nombre:string;consultas:number;cobrado:number;pagos:number}[]
  return {cobrado:r?.cobrado??0,pagos:r?.pagos??0,particulares:r?.particulares??0,copagos:r?.copagos??0,deben:deuda?.deben??0,ticket:r?.pagos?Math.round(r.cobrado/r.pagos):0,facturado:r?.facturado??0,interno:r?.interno??0,sinComprobante:r?.sinComprobante??0,medios,prestaciones:prestaciones.map(p=>({...p,promedio:p.pagos?Math.round(p.cobrado/p.pagos):0}))}
}
