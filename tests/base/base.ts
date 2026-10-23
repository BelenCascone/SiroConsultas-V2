// Base SQLite en memoria con las mismas migraciones que D1 (y, si se pide, los datos ficticios de seed/seed.sql).
// D1 es SQLite: los triggers y CHECK se comportan igual. Las claves foráneas quedan activas, como en D1.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'

const raiz = new URL('../../', import.meta.url)
const leer = (rel: string) => readFileSync(new URL(rel, raiz), 'utf8')
export const MIGRACIONES = readdirSync(new URL('migrations/', raiz)).filter((f) => f.endsWith('.sql')).sort()

export function baseNueva({ conDatos = false } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const m of MIGRACIONES) db.exec(leer(`migrations/${m}`))
  if (conDatos) db.exec(leer('seed/seed.sql'))
  return db
}

/** Ejecuta SQL y devuelve el mensaje de error (o null si no falló). */
export function errorDe(db: DatabaseSync, sql: string) {
  try { db.exec(sql); return null } catch (e) { return (e as Error).message }
}

/** Adaptador mínimo de D1 sobre node:sqlite, para probar la app real sin Cloudflare. */
export const d1 = (db: DatabaseSync) => ({
  /** Como en D1, las sentencias del lote van juntas: o entran todas o ninguna. */
  async batch(sentencias: { run(): Promise<unknown> }[]) {
    db.exec('BEGIN')
    try { const r = []; for (const s of sentencias) r.push(await s.run()); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
  },
  prepare(sql: string) {
    let args: any[] = []
    const st = {
      bind(...a: any[]) { args = a; return st },
      async first() { return (db.prepare(sql).get(...args) as any) ?? null },
      async all() { return { results: db.prepare(sql).all(...args) as any[] } },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } } },
    }
    return st
  },
}) as unknown as D1Database
