# SiroConsultas v2 — BC Informática

Sistema para profesionales de la salud que trabajan sin secretaria: agenda, pacientes con ficha e historia clínica, cobros con comprobante (interno o factura C de ARCA), documentos clínicos y estadísticas. **Un sistema por profesional**, con su base, su marca y sus módulos. Este es el **repositorio madre**: el núcleo del que salen las instalaciones de cada cliente.

## Tecnología
TypeScript + [Hono](https://hono.dev) (HTML armado en el servidor) sobre Cloudflare **Workers**, **D1** (base) y **R2** (archivos). Pruebas con Vitest y Playwright; despliegue con GitHub Actions.

## Documentación
- [Análisis funcional v2](docs/ANALISIS_FUNCIONAL.md) — decisiones, flujos, entidades, reglas y etapas (aprobado el 23/10/2026).
- [Diseño aprobado](docs/DISENO_APROBADO.md) y [maquetas](docs/pantallas/) — estilo «Nube» y las 14 pantallas de compu.
- [Despliegue](docs/DESPLIEGUE.md) — qué cargar en GitHub y en Cloudflare, y cómo activar el segundo código.
- [Tareas](docs/TAREAS.md) — qué se hizo y qué sigue.
- [Reglas para quien programa](CLAUDE.md) (lo mismo en `AGENTS.md`).

## Correr en la compu (opcional)
```bash
npm install
npm run db:local          # base local con datos ficticios
cp .dev.vars.ejemplo .dev.vars   # y completá los valores
npm run dev               # http://localhost:8787
npm run test:todo         # tipos, base, app y punta a punta
```

## Protección de datos
Repositorio de **código**, no de datos médicos. Nunca subir historias clínicas reales, datos personales, archivos clínicos identificables, secretos ni credenciales. Para diseño, demos y pruebas, solo datos ficticios. Antes de producción, términos y privacidad redactados y revisados por un abogado (leyes 25.326 y 26.529).
