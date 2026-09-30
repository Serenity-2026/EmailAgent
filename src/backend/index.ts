import { databaseFromEnvironment } from './database'
import { createBackendServer } from './server'

async function start(): Promise<void> {
  const db = databaseFromEnvironment()
  await db.initialize()
  const server = createBackendServer(db)
  const port = Number(process.env.API_PORT || 3210)
  server.listen(port, process.env.API_HOST || '127.0.0.1', () => process.stdout.write(`EmailAgent backend listening on ${port}\n`))
  const shutdown = (): void => { server.close(() => { void db.pool.end().then(() => process.exit(0)) }); server.closeAllConnections() }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

void start().catch(() => { process.stderr.write('EmailAgent backend startup failed. Check database connection and environment configuration.\n'); process.exitCode = 1 })
