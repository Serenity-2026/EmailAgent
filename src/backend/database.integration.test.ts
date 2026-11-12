import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { createPool, type Pool } from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from './database'
import { MysqlStore } from './store'
import { createBackendServer } from './server'
import { emptyData, encryptVault, keyFor } from '../shared/vault'
import { BackendClient } from '../main/backend-client'
import { LoginAttemptLimiter } from './login-limiter'

const encryption = vi.hoisted(() => ({ fail: false }))
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => { if (encryption.fail) throw new Error('BAD_DECRYPT'); return value.toString() }
} }))
vi.mock('./mail', async (original) => ({ ...await original<typeof import('./mail')>(),
  testAccount: vi.fn().mockResolvedValue(undefined), listMail: vi.fn().mockResolvedValue([]), sendMail: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./ai', async (original) => ({ ...await original<typeof import('./ai')>(), testAiConnection: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./agent', async (original) => ({ ...await original<typeof import('./agent')>(), runAgentTask: vi.fn() }))
import { runAgentTask } from './agent'

describe.skipIf(process.env.EMAILAGENT_MYSQL_TEST !== '1')('MySQL backend integration', () => {
  let root: Pool
  let db: Database
  let server: Server
  let baseUrl = ''
  const databaseName = `emailagent_test_${randomBytes(6).toString('hex')}`
  const clients: BackendClient[] = []
  const directories: string[] = []
  const mysql = { host: '127.0.0.1', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD, port: Number(process.env.MYSQL_PORT || 3306) }
  const ai = { baseUrl: 'https://example.com/v1', apiKey: 'secret-ai-key', model: 'test-model', dailyTime: '09:00', autoDaily: false }
  const account = { provider: 'qq', address: 'student@qq.com', authorizationCode: 'mail-secret-code' }

  async function startServer(loginLimiter?: LoginAttemptLimiter): Promise<void> {
    server = createBackendServer(db, { loginLimiter })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  }
  async function closeServer(): Promise<void> {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  async function rpc(channel: string, args: unknown[] = [], token = ''): Promise<{ status: number; result: any; error?: string }> {
    const response = await fetch(`${baseUrl}/api/rpc/${encodeURIComponent(channel)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ args })
    })
    return { status: response.status, ...await response.json() }
  }
  async function login(username = 'dmc', password = '123456'): Promise<string> {
    const response = await rpc('auth:login', [username, password])
    expect(response.status).toBe(200)
    return response.result.token
  }

  beforeAll(async () => {
    root = createPool(mysql)
    await root.query(`CREATE DATABASE ${databaseName} CHARACTER SET utf8mb4`)
    db = new Database(createPool({ ...mysql, database: databaseName }), randomBytes(32), true)
  })
  beforeEach(async () => {
    await db.initialize()
    await db.pool.execute('DELETE FROM sessions')
    await db.pool.execute('DELETE FROM migration_receipts')
    await db.pool.execute('DELETE FROM users')
    await db.pool.execute('DELETE FROM app_state')
    await db.initialize()
    vi.clearAllMocks()
    await startServer()
  })
  afterEach(async () => {
    clients.splice(0).forEach((client) => client.stopEvents())
    encryption.fail = false
    await closeServer()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
  })
  afterAll(async () => { await db.pool.end(); await root.query(`DROP DATABASE ${databaseName}`); await root.end() })

  it('requires authentication and rejects malformed or browser-origin requests', async () => {
    expect((await rpc('accounts:list')).status).toBe(401)
    expect((await rpc('auth:login', ['dmc', 'wrong'])).error).toContain('账号或密码错误')
    expect((await rpc('mail:get', ['one', 'INBOX', -1])).status).toBe(400)
    expect((await rpc('missing:channel')).status).toBe(404)
    const response = await fetch(`${baseUrl}/api/rpc/auth%3Alogin`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ args: ['dmc', '123456'] }) })
    expect(response.status).toBe(403)
  })

  it('bootstraps an empty database once and keeps the new session across a restart', async () => {
    await db.pool.execute('DELETE FROM sessions')
    await db.pool.execute('DELETE FROM users')
    await db.pool.execute('UPDATE app_state SET initialized = FALSE WHERE id = 1')
    expect((await rpc('auth:bootstrap-status')).result).toEqual({ required: true, demoMode: true })
    const created = await rpc('auth:bootstrap', ['admin', 'strong-password'])
    expect(created.status).toBe(200)
    expect(created.result.username).toBe('admin')
    expect((await rpc('auth:session', [], created.result.token)).result.username).toBe('admin')
    expect((await rpc('auth:bootstrap', ['other', 'other-password'])).error).toContain('已经完成初始化')
    await closeServer(); await startServer()
    expect((await rpc('auth:session', [], created.result.token)).result.username).toBe('admin')
    expect(await db.user('dmc')).toBeNull()
  })

  it('preserves existing users when adding bootstrap state to an older database', async () => {
    const before = await MysqlStore.login(db, 'dmc', '123456')
    await before.setThemeMode('dark')
    before.logout()
    await db.pool.execute('DROP TABLE app_state')
    await db.initialize()
    expect((await db.bootstrapStatus()).required).toBe(false)
    const restored = await MysqlStore.login(db, 'dmc', '123456')
    expect(restored.themeMode).toBe('dark')
    restored.logout()
  })

  it('rate-limits repeated login failures without revealing whether an account exists', async () => {
    await closeServer()
    let now = 1_000
    await startServer(new LoginAttemptLimiter(() => now, 2, 60_000, 30_000))
    const wrongUser = await rpc('auth:login', ['missing', 'wrong'])
    const wrongPassword = await rpc('auth:login', ['dmc', 'wrong'])
    expect(wrongUser.error).toBe('账号或密码错误')
    expect(wrongPassword.error).toBe('账号或密码错误')
    expect((await rpc('auth:login', ['dmc', 'wrong-again'])).status).toBe(429)
    expect((await rpc('auth:login', ['dmc', '123456'])).status).toBe(429)
    now += 30_001
    expect((await rpc('auth:login', ['dmc', '123456'])).status).toBe(200)
  })

  it('persists isolated mailbox, AI, theme and history data as encrypted MySQL values', async () => {
    const token = await login()
    const added = await rpc('accounts:add', [account], token)
    expect(added.status).toBe(200)
    expect(added.result.authorizationCode).toBeUndefined()
    expect((await rpc('ai:settings:save', [ai], token)).status).toBe(200)
    expect((await rpc('theme:set', ['dark'], token)).status).toBe(200)
    const store = await MysqlStore.login(db, 'dmc', '123456')
    const recent = new Date().toISOString()
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    await store.setAgentConversations([
      { id: 'recent', updatedAt: recent, messages: [{ id: 'new', role: 'user', content: '私密课程内容', createdAt: recent }] },
      { id: 'expired', updatedAt: old, messages: [{ id: 'old', role: 'user', content: '旧内容', createdAt: old }] }
    ])
    expect((await rpc('agent:history', [], token)).result.map((item: { id: string }) => item.id)).toEqual(['recent'])
    const [rows] = await db.pool.query('SELECT vault FROM users WHERE username = "dmc"')
    const serialized = JSON.stringify(rows)
    for (const secret of [account.authorizationCode, ai.apiKey, '私密课程内容', '123456']) expect(serialized).not.toContain(secret)
    await rpc('auth:create', ['other', 'other-password'], token)
    const other = await login('other', 'other-password')
    expect((await rpc('accounts:list', [], other)).result).toEqual([])
    expect((await rpc('agent:history', [], other)).result).toEqual([])
    expect((await rpc('theme:get', [], other)).result).toBe('system')
    expect((await rpc('accounts:remove', [added.result.id], other)).error).toContain('不存在')
    store.logout()
  })

  it('keeps sessions and data after a backend restart and revokes them on logout', async () => {
    const token = await login()
    await rpc('accounts:add', [account], token)
    await rpc('theme:set', ['dark'], token)
    await closeServer(); await startServer()
    expect((await rpc('auth:session', [], token)).result.username).toBe('dmc')
    expect((await rpc('accounts:list', [], token)).result[0].address).toBe(account.address)
    expect((await rpc('theme:get', [], token)).result).toBe('dark')
    await rpc('auth:logout', [], token)
    expect((await rpc('auth:session', [], token)).status).toBe(401)
  })

  it('restores encrypted digest history after a backend restart', async () => {
    const token = await login()
    const store = await MysqlStore.login(db, 'dmc', '123456')
    const generatedAt = new Date().toISOString()
    await store.setDigestHistory([{
      date: generatedAt.slice(0, 10), generatedAt, mode: 'auto', content: '持久化摘要', warnings: [], sources: [{
        uid: 7, accountId: 'account', folder: 'INBOX', from: 'teacher@example.com', subject: '课程',
        date: generatedAt, unread: true
      }]
    }])
    store.logout()
    expect((await rpc('ai:digest:history', [], token)).result[0].content).toBe('持久化摘要')
    await closeServer(); await startServer()
    const restored = await rpc('ai:digest:history', [], token)
    expect(restored.result[0]).toMatchObject({ mode: 'auto', content: '持久化摘要' })
    expect(restored.result[0].sources[0]).not.toHaveProperty('text')
  })

  it('refreshes the current session key and revokes other sessions after a password change', async () => {
    const first = await login()
    const second = await login()
    expect((await rpc('auth:password', ['123456', 'next-password'], first)).status).toBe(200)
    expect((await rpc('auth:session', [], second)).status).toBe(401)
    await closeServer(); await startServer()
    expect((await rpc('auth:session', [], first)).status).toBe(200)
    expect((await rpc('auth:login', ['dmc', '123456'])).status).toBe(400)
    expect(await login('dmc', 'next-password')).toHaveLength(64)
  })

  it('imports old encrypted user data once while keeping the password and credentials', async () => {
    const salt = randomBytes(16).toString('base64')
    const key = keyFor('old-password', salt)
    const vault = encryptVault('dmc', salt, key, { ...emptyData(), accounts: [{ id: 'legacy', ...account, provider: 'qq' }], ai })
    key.fill(0)
    const hash = 'a'.repeat(64)
    expect(await db.importVaults([vault], hash)).toBe(1)
    expect(await db.importVaults([vault], hash)).toBe(0)
    const token = await login('dmc', 'old-password')
    expect((await rpc('accounts:list', [], token)).result[0].id).toBe('legacy')
    const store = await MysqlStore.login(db, 'dmc', 'old-password')
    expect(store.accounts[0].authorizationCode).toBe(account.authorizationCode)
    expect(store.ai.apiKey).toBe(ai.apiKey)
    const wrong = { ...vault, ciphertext: 'invalid' }
    await expect(db.importVaults([wrong], 'b'.repeat(64))).rejects.toThrow('已有数据')
    store.logout()
  })

  it('rejects stale concurrent writes instead of overwriting another client', async () => {
    const first = await MysqlStore.login(db, 'dmc', '123456')
    const second = await MysqlStore.login(db, 'dmc', '123456')
    await first.setThemeMode('dark')
    await expect(second.setAi(ai)).rejects.toThrow('已更新')
    await second.refresh(); await second.setAi(ai)
    await first.refresh()
    expect(first.themeMode).toBe('dark')
    expect(first.ai.apiKey).toBe(ai.apiKey)
    first.logout(); second.logout()
  })

  it('stops an Agent task when the session is revoked during model work', async () => {
    const token = await login()
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(runAgentTask).mockImplementationOnce(async (_settings, _prompt, _accounts, _history, progress, ensureActive) => {
      progress({ stage: 'planning', detail: '处理中' }); started()
      await new Promise<void>((resolve) => { release = resolve })
      ensureActive!()
      return { answer: '回答', sources: [], actions: [], warnings: [], truncated: false, scope: '近期' }
    })
    const task = rpc('agent:run', ['总结邮件', '', randomUUID()], token)
    await waiting
    expect((await rpc('auth:logout', [], token)).status).toBe(200)
    release()
    expect((await task).error).toContain('登录状态已变化')
    const restored = await MysqlStore.login(db, 'dmc', '123456')
    expect(restored.agentConversations).toEqual([])
    restored.logout()
  })

  it('restores the desktop token, returns to login for a corrupt token, and reports an unavailable service', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emailagent-api-client-')); directories.push(directory)
    const first = new BackendClient(directory, () => undefined, baseUrl); clients.push(first)
    const result = await first.request('auth:login', ['dmc', '123456'])
    expect(result).toEqual({ username: 'dmc' })
    first.stopEvents()
    const second = new BackendClient(directory, () => undefined, baseUrl); clients.push(second)
    await second.restoreToken()
    expect((await second.request<{ username: string }>('auth:session')).username).toBe('dmc')
    await second.request('auth:logout')
    await expect(readFile(join(directory, 'emailagent.api-session'))).rejects.toMatchObject({ code: 'ENOENT' })
    await first.request('auth:login', ['dmc', '123456']); first.stopEvents()
    encryption.fail = true
    const third = new BackendClient(directory, () => undefined, baseUrl); clients.push(third)
    await third.restoreToken()
    expect((await third.request<{ username: null }>('auth:session')).username).toBeNull()
    const offline = new BackendClient(directory, () => undefined, 'http://127.0.0.1:1'); clients.push(offline)
    await expect(offline.request('auth:session')).rejects.toThrow('无法连接后端服务')
    encryption.fail = false
    await first.request('auth:login', ['dmc', '123456']); first.stopEvents()
    await offline.restoreToken()
    await offline.request('auth:logout')
    await expect(readFile(join(directory, 'emailagent.api-session'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
