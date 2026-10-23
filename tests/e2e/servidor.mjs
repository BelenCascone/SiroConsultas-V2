// Levanta `wrangler dev` con una base local NUEVA (migraciones + datos ficticios de seed/seed.sql) en el puerto dado.
// Cada archivo de pruebas de punta a punta usa su propio servidor y su propia base: no dependen del orden.
// Uso (lo llama playwright.config.ts): node tests/e2e/servidor.mjs <puerto>
import { execFileSync, spawn } from 'node:child_process'
import { rmSync } from 'node:fs'

const puerto = process.argv[2]
const dir = `.wrangler/e2e/${puerto}`
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CI: '1' } })

rmSync(dir, { recursive: true, force: true })
wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', dir])
wrangler(['d1', 'execute', 'DB', '--local', '--persist-to', dir, '--file=seed/seed.sql'])

const dev = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', puerto, '--inspector-port', String(Number(puerto) + 1000),
  '--persist-to', dir, '--show-interactive-dev-session=false',
  '--var', 'SESION_SECRETO:secreto-solo-para-pruebas-e2e-0123456789',
  '--var', 'CLAVE_PRUEBA:prueba-e2e-123',
  '--var', 'TOTP_CLAVE:clave-totp-solo-para-pruebas-e2e-0123456789'], { stdio: 'inherit' })
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => dev.kill(s))
dev.on('exit', (code) => process.exit(code ?? 0))
