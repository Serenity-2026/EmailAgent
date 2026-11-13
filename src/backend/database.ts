import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createPool, type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise'
import { decryptVault, emptyData, encryptVault, keyFor, type UserVault } from '../shared/vault'

interface UserRow extends RowDataPacket { vault: UserVault | string; revision: number }
interface SessionRow extends RowDataPacket { username: string; secret: string | { iv: string; tag: string; ciphertext: string } }
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex')

export function databaseFromEnvironment(): Database {
  const secret = Buffer.from(process.env.SESSION_KEY || '', 'base64')
  if (secret.length !== 32) throw new Error('SESSION_KEY 必须是 32 字节的 Base64 密钥')
  return new Database(createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'emailagent', password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'emailagent', connectionLimit: 8,
    charset: 'utf8mb4', timezone: 'Z', connectTimeout: 10_000
  }), secret, process.env.EMAILAGENT_DEMO_MODE === '1')
}

export class Database {
  constructor(readonly pool: Pool, private readonly sessionKey: Buffer, readonly demoMode = false) {}

  async initialize(): Promise<void> {
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS app_state (
      id TINYINT UNSIGNED PRIMARY KEY,
      initialized BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`)
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS users (
      username VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      vault JSON NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`)
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY,
      username VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      secret JSON NOT NULL, expires_at DATETIME NOT NULL,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
      INDEX (expires_at)
    )`)
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS migration_receipts (
      source_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY,
      imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
    await this.pool.execute('INSERT IGNORE INTO app_state (id, initialized) VALUES (1, FALSE)')
    await this.pool.execute('UPDATE app_state SET initialized = TRUE WHERE id = 1 AND EXISTS (SELECT 1 FROM users LIMIT 1)')
    if (this.demoMode && (await this.bootstrapStatus()).required) {
      const salt = randomBytes(16).toString('base64')
      const key = keyFor('123456', salt)
      try { await this.bootstrapUser(encryptVault('dmc', salt, key, emptyData())) } finally { key.fill(0) }
    }
    await this.pool.execute('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()')
  }

  async bootstrapStatus(): Promise<{ required: boolean; demoMode: boolean }> {
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT initialized FROM app_state WHERE id = 1')
    return { required: !Boolean(rows[0]?.initialized), demoMode: this.demoMode }
  }

  async bootstrapUser(vault: UserVault): Promise<void> {
    const connection = await this.pool.getConnection()
    let existingUser = false
    try {
      await connection.beginTransaction()
      const [state] = await connection.execute<RowDataPacket[]>('SELECT initialized FROM app_state WHERE id = 1 FOR UPDATE')
      if (!state.length || state[0].initialized) throw new Error('系统已经完成初始化')
      const [users] = await connection.execute<RowDataPacket[]>('SELECT username FROM users LIMIT 1 FOR UPDATE')
      if (users.length) {
        await connection.execute('UPDATE app_state SET initialized = TRUE WHERE id = 1')
        existingUser = true
      } else {
        await connection.execute('INSERT INTO users (username, vault) VALUES (?, ?)', [vault.username, JSON.stringify(vault)])
        await connection.execute('UPDATE app_state SET initialized = TRUE WHERE id = 1')
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally { connection.release() }
    if (existingUser) throw new Error('系统已经完成初始化')
  }

  async user(username: string): Promise<{ vault: UserVault; revision: number } | null> {
    const [rows] = await this.pool.execute<UserRow[]>('SELECT vault, revision FROM users WHERE username = ?', [username])
    if (!rows[0]) return null
    return { vault: typeof rows[0].vault === 'string' ? JSON.parse(rows[0].vault) : rows[0].vault, revision: rows[0].revision }
  }

  async addUser(vault: UserVault): Promise<void> {
    try {
      await this.pool.execute('INSERT INTO users (username, vault) VALUES (?, ?)', [vault.username, JSON.stringify(vault)])
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new Error('账号已存在')
      throw error
    }
  }

  async save(vault: UserVault, revision: number, connection: Pool | PoolConnection = this.pool): Promise<void> {
    const [result] = await connection.execute<ResultSetHeader>(
      'UPDATE users SET vault = ?, revision = revision + 1 WHERE username = ? AND revision = ?',
      [JSON.stringify(vault), vault.username, revision])
    if (result.affectedRows !== 1) throw new Error('用户数据已更新，请重试当前操作')
  }

  private seal(username: string, key: Buffer): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.sessionKey, iv)
    cipher.setAAD(Buffer.from(username))
    const ciphertext = Buffer.concat([cipher.update(key), cipher.final()])
    return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') })
  }

  async createSession(username: string, key: Buffer): Promise<string> {
    const token = randomBytes(32).toString('hex')
    await this.pool.execute('INSERT INTO sessions (token_hash, username, secret, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))',
      [tokenHash(token), username, this.seal(username, key)])
    return token
  }

  async session(token: string): Promise<{ username: string; key: Buffer } | null> {
    const [rows] = await this.pool.execute<SessionRow[]>('SELECT username, secret FROM sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP()', [tokenHash(token)])
    if (!rows[0]) return null
    const { username } = rows[0]
    try {
      const secret = typeof rows[0].secret === 'string' ? JSON.parse(rows[0].secret) : rows[0].secret
      const decipher = createDecipheriv('aes-256-gcm', this.sessionKey, Buffer.from(secret.iv, 'base64'))
      decipher.setAAD(Buffer.from(username))
      decipher.setAuthTag(Buffer.from(secret.tag, 'base64'))
      const key = Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()])
      if (key.length !== 32) throw new Error('会话无效')
      return { username, key }
    } catch {
      await this.revoke(token)
      return null
    }
  }

  async revoke(token: string): Promise<void> {
    await this.pool.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)])
  }

  async changePassword(vault: UserVault, revision: number, token: string, key: Buffer): Promise<void> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      await this.save(vault, revision, connection)
      await connection.execute('DELETE FROM sessions WHERE username = ? AND token_hash <> ?', [vault.username, tokenHash(token)])
      await connection.execute('UPDATE sessions SET secret = ? WHERE token_hash = ?', [this.seal(vault.username, key), tokenHash(token)])
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally { connection.release() }
  }

  async importVaults(vaults: UserVault[], sourceHash: string): Promise<number> {
    if (!vaults.length || vaults.some((vault) => !vault || !/^[A-Za-z0-9_]{3,32}$/.test(vault.username) ||
      ['salt', 'iv', 'tag', 'ciphertext'].some((field) => typeof vault[field as keyof UserVault] !== 'string' || !vault[field as keyof UserVault]))) {
      throw new Error('旧用户数据格式无效')
    }
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [receipts] = await connection.execute<RowDataPacket[]>('SELECT source_hash FROM migration_receipts WHERE source_hash = ?', [sourceHash])
      if (receipts.length) { await connection.commit(); return 0 }
      for (const vault of vaults) {
        const [rows] = await connection.execute<UserRow[]>('SELECT vault, revision FROM users WHERE username = ? FOR UPDATE', [vault.username])
        if (rows.length) {
          const existing = typeof rows[0].vault === 'string' ? JSON.parse(rows[0].vault) as UserVault : rows[0].vault
          if (['username', 'salt', 'iv', 'tag', 'ciphertext'].every((field) => existing[field as keyof UserVault] === vault[field as keyof UserVault])) continue
          let isSeed = false
          const key = keyFor('123456', existing.salt)
          try { isSeed = existing.username === 'dmc' && JSON.stringify(decryptVault(existing, key)) === JSON.stringify(emptyData()) } catch { /* Existing user must not be overwritten. */ }
          finally { key.fill(0) }
          if (!isSeed) throw new Error(`数据库中的 ${vault.username} 已有数据，迁移已取消`)
          await connection.execute('DELETE FROM sessions WHERE username = ?', [vault.username])
          await connection.execute('UPDATE users SET vault = ?, revision = revision + 1 WHERE username = ?', [JSON.stringify(vault), vault.username])
        } else {
          await connection.execute('INSERT INTO users (username, vault) VALUES (?, ?)', [vault.username, JSON.stringify(vault)])
        }
      }
      await connection.execute('INSERT INTO migration_receipts (source_hash) VALUES (?)', [sourceHash])
      await connection.commit()
      return vaults.length
    } catch (error) { await connection.rollback(); throw error }
    finally { connection.release() }
  }
}
