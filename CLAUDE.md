# CLAUDE.md — mismas reglas que AGENTS.md

Lo leen Claude, Codex y cualquier agente. Producto: **SiroConsultas v2**, de BC Informática. Repositorio madre: se rehace desde cero lo aprobado el 23/10/2026.

**Fuente funcional:** `docs/ANALISIS_FUNCIONAL.md` (decisiones, flujos, entidades, reglas, etapas) y `docs/DISENO_APROBADO.md` (lo aprobado de cada pantalla; las maquetas están en `docs/pantallas/`). Lo que no esté ahí no se inventa: se le pregunta a Belén.

## Cómo se trabaja
- **Una tarea = una rama = un PR a `main`.** La rama sale de `origin/main` recién traído. Nunca push directo a `main`; une Belén. Las tareas están en `docs/TAREAS.md`.
- **Se avanza por etapas** (análisis, «Alcance por etapas»): cada etapa se puede usar sola. Las pantallas del celular y la app del paciente ya están aprobadas (25/10): se programan en su etapa.
- **Antes de abrir el PR:** `npm run typecheck`, `npm test` y `npm run test:e2e`, todo en verde. Sumá pruebas para lo nuevo: reglas de la base en `tests/base/`, la app real en `tests/unidad/` (con `tests/unidad/ayuda.ts`), recorridos en `tests/e2e/`.
- Español rioplatense, de vos, claro y corto: interfaz, código, commits y PR.

## Reglas técnicas
- **Stack:** TypeScript + Hono con JSX armado en el servidor, sobre Cloudflare Workers, D1 (base) y R2 (archivos). Sin frameworks nuevos ni dependencias sin acordarlo con Belén. El JS del navegador vive en `public/app.js`, sin dependencias.
- **CSP estricta:** nada de `<script>` ni `style="…"` en línea (hay una prueba que lo controla). Todo estilo va en `public/estilos.css` con clases; todo comportamiento, con atributos `data-*` que engancha `app.js`.
- **Una sola profesional, sin roles.** La especialidad no es un módulo: adapta el registro clínico.
- **Módulos por instalación** (`src/lib/instalacion.ts`): toda ruta nueva de un módulo se registra en `PREFIJOS`; todo enlace desde el núcleo lleva `data-modulo="<módulo>"`.
- **Base:** migraciones aditivas `migrations/NNNN_nombre.sql`; nunca se edita una ya publicada. Lo clínico y lo financiero no se borra ni se reescribe: se anula con motivo, y los triggers lo garantizan (seguí el patrón de `0001_esquema.sql`). D1 limita las consultas compuestas: en triggers, un `INSERT` por caso en vez de `UNION ALL` largos.
- **Todo turno, consulta y cobro pertenece a una ficha.** El DNI es el identificador único del paciente.
- **Diseño «Nube»:** colores, radios y sombras solo con las variables de `public/estilos.css` (nada de hex sueltos). Lima (`--destacado`) como máximo una acción por pantalla; botón oscuro, uno por ventana. Controles de 44 px, texto de 13 px como piso, contraste AA, foco visible, sin scroll horizontal ni anidado. Notebook (1366×657) y celular (390 px) pesan igual. Los componentes están en `src/ui/componentes.tsx` y se ven en `/componentes` (solo demo).
- Importes en centavos (enteros). Fechas de agenda en horario de Argentina (`src/lib/fechas.ts`); marcas de tiempo en UTC.
- **Datos:** solo ficticios en semillas, pruebas, capturas y PR. Nunca datos reales, secretos ni `.dev.vars` en el repo.
