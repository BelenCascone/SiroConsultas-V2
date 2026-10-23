// Muestrario de componentes del estilo «Nube» (solo en la demo). Sirve para dar el OK visual a las piezas
// antes de armar las pantallas: todo lo que se ve acá es lo que usan las etapas siguientes.
import { Hono } from 'hono'
import type { Env } from '../tipos'
import { leerInstalacion } from '../lib/instalacion'
import { Pagina } from '../ui/pagina'
import { Aviso, Boton, Campo, Estado, Interruptor, Opciones, Pastilla, Pasos, Tarjeta, Ventana, pesos } from '../ui/componentes'
import { Mas } from '../ui/iconos'
import { datosProfesional, avisosSinLeer } from './inicio'
import { modoPrueba } from './ingreso'

const COLORES = [
  ['c-fondo', 'Fondo · Alabaster'], ['c-brillo', 'Brillo · Half Baked'], ['c-destacado', 'Acción · Mindaro'],
  ['c-texto', 'Texto · Holly'], ['c-enlace', 'Enlaces'], ['c-superficie-2', 'Campos y filas'],
]

export const componentes = new Hono<Env>()

componentes.get('/componentes', async (c) => {
  if (!modoPrueba(c)) return c.notFound()
  const [prof, avisos] = await Promise.all([datosProfesional(c), avisosSinLeer(c)])
  return c.html(
    <Pagina titulo="Componentes" seccion="otra" inst={leerInstalacion(c.env)} email={c.get('email')!} nombre={prof.nombre} avisos={avisos}>
      <section class="portada">
        <span class="portada-sub">Etapa 0 · solo en la demo</span>
        <h1>Componentes</h1>
      </section>

      <Tarjeta titulo="Colores">
        <div class="muestra-colores">
          {COLORES.map(([clase, nombre]) => <div class="color"><i class={clase} /><span>{nombre}</span></div>)}
        </div>
      </Tarjeta>

      <div class="grilla">
        <Tarjeta titulo="Botones">
          <div class="fila">
            <Boton variante="destacado"><Mas />Dar turno</Boton>
            <Boton>Cobrar</Boton>
            <Boton variante="oscuro">Guardar</Boton>
          </div>
          <div class="fila">
            <Boton variante="borde">Otro horario</Boton>
            <Boton variante="peligro">Dar de baja</Boton>
            <Boton variante="texto">Ahora no</Boton>
          </div>
          <p class="chico suave">Lima: una sola acción por pantalla. Oscuro: una por ventana.</p>
        </Tarjeta>

        <Tarjeta titulo="Estados">
          <div class="fila">
            <Estado estado="confirmado" /><Estado estado="atendido" /><Estado estado="debe" /><Estado estado="ausente" />
          </div>
          <div class="fila">
            <Estado estado="sin_respuesta" /><Estado estado="cancelado" /><Estado estado="primera" /><Estado estado="solicitado" />
            <Estado estado="incompleta" />
          </div>
        </Tarjeta>

        <Tarjeta titulo="Filtros en pastilla">
          <div class="fila">
            <Pastilla actual alterna cuenta={42}>Todos</Pastilla>
            <Pastilla alterna cuenta={3}>Te deben</Pastilla>
            <Pastilla alterna cuenta={5}>Control vencido</Pastilla>
            <Pastilla alterna cuenta={2}>Ficha incompleta</Pastilla>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Pasos">
          <Pasos pasos={['Paciente', 'Día y hora', 'Guardar']} actual={1} />
        </Tarjeta>

        <Tarjeta titulo="Formulario">
          <Campo etiqueta="DNI" nombre="dni" modoTeclado="numeric" valor="30111222" />
          <Campo etiqueta="Celular" nombre="celular" tipo="tel" ayuda="Para mandarle el aviso por WhatsApp." />
          <Campo etiqueta="Correo (opcional)" nombre="correo" tipo="email" error="Revisá el correo: le falta la @." />
          <Opciones leyenda="¿Cuánto pagó?" nombre="cuanto" elegida="todo" opciones={[{ valor: 'todo', texto: 'Todo' }, { valor: 'parte', texto: 'Una parte' }, { valor: 'nada', texto: 'Nada por ahora' }]} />
          <Interruptor etiqueta="Repetir" nombre="repetir" ayuda="Cada N semanas hasta una fecha." />
          <Interruptor etiqueta="Avisarle por WhatsApp" nombre="avisar" marcado />
        </Tarjeta>

        <Tarjeta titulo="Avisos y ventanas">
          <Aviso>Tenés 2 pedidos de turno online para responder.</Aviso>
          <Aviso tipo="ambar">Falta el DNI para facturar.</Aviso>
          <Aviso tipo="ok">Pago guardado.</Aviso>
          <Aviso tipo="error">El pago supera el saldo.</Aviso>
          <Boton abre="ventana-cobro" variante="oscuro">Abrir una ventana</Boton>
        </Tarjeta>

        <Tarjeta titulo="Terminaron y falta cobrar" tono="ambar">
          <ul class="lista">
            <li><span><strong>Tomás Ferreyra</strong><br /><span class="chico">Consulta · 10:30</span></span><span class="importe">{pesos(1800000)}</span></li>
            <li><span><strong>Ana Gómez</strong><br /><span class="chico">Control · 11:00</span></span><span class="importe">{pesos(950050)}</span></li>
          </ul>
        </Tarjeta>
      </div>

      <Ventana id="ventana-cobro" titulo="Cobrar a Tomás Ferreyra" sub="Consulta · hoy 10:30"
        pie={<><Boton cierra variante="texto">Ahora no</Boton><Boton cierra variante="oscuro">Guardar pago de {pesos(1800000)}</Boton></>}>
        <Opciones leyenda="¿Cómo pagó?" nombre="medio" elegida="efectivo" opciones={[{ valor: 'efectivo', texto: 'Efectivo' }, { valor: 'transferencia', texto: 'Transferencia' }, { valor: 'tarjeta', texto: 'Tarjeta' }, { valor: 'otro', texto: 'Otro' }]} />
      </Ventana>
    </Pagina>
  )
})
