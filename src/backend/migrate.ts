import { createHash } from 'node:crypto'
import { chmod, copyFile, readFile } from 'node:fs/promises'
import { databaseFromEnvironment } from './database'
import type { VaultFile } from '../shared/vault'

async function migrate(): Promise<void> {
  const path = process.argv[2]
  if (!path) throw new Error('请传入旧版 emailagent.enc 的完整路径')
  const raw = await readFile(path, 'utf8')
  const file = JSON.parse(raw) as VaultFile
  if (file.version !== 2 || !Array.isArray(file.users)) throw new Error('仅支持已升级为版本 2 的用户数据')
  const db = databaseFromEnvironment()
  try {
    await db.initialize()
    const backup = `${path}.mysql-backup-${Date.now()}`
    await copyFile(path, backup); await chmod(backup, 0o600)
    const count = await db.importVaults(file.users, createHash('sha256').update(raw).digest('hex'))
    process.stdout.write(`Imported ${count} user vault(s). Original encrypted file preserved.\n`)
  } finally { await db.pool.end() }
}
void migrate().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : '迁移失败'}\n`); process.exitCode = 1 })
