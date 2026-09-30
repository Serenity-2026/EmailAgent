import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile, rename, chmod, copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { Account, AgentConversation, AiSettingsInput, ThemeMode } from '../shared/models'

export interface StoredAccount extends Account {
  authorizationCode: string
}

interface StoredData {
  accounts: StoredAccount[]
  ai: AiSettingsInput
  agentConversations?: AgentConversation[]
  themeMode?: ThemeMode
}

interface UserVault {
  username: string
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

interface VaultFile {
  version: 2
  users: UserVault[]
}

interface SavedSession {
  version: 1
  username: string
  secret: string
}

const emptyData = (): StoredData => ({
  accounts: [],
  ai: { baseUrl: '', model: '', apiKey: '', dailyTime: '09:00', autoDaily: false },
  agentConversations: [],
  themeMode: 'system'
})

function currentConversations(items: unknown): AgentConversation[] {
  if (!Array.isArray(items)) return []
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  return (items as AgentConversation[]).filter((item) => item && typeof item.id === 'string' &&
    typeof item.updatedAt === 'string' && Array.isArray(item.messages) &&
    Number.isFinite(Date.parse(item.updatedAt)) && Date.parse(item.updatedAt) >= cutoff)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30)
    .map((item) => ({ ...item, messages: item.messages.filter((message) =>
      typeof message.createdAt === 'string' && Number.isFinite(Date.parse(message.createdAt)) &&
      Date.parse(message.createdAt) >= cutoff).slice(-40) }))
    .filter((item) => item.messages.length > 0)
}

function isStoredData(value: unknown): value is StoredData {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return Array.isArray(data.accounts) && !!data.ai && typeof data.ai === 'object'
}

function keyFor(password: string, salt: string): Buffer {
  return scryptSync(password, Buffer.from(salt, 'base64'), 32)
}

function decryptVault(vault: UserVault, key: Buffer): StoredData {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(vault.iv, 'base64'))
  decipher.setAAD(Buffer.from(vault.username, 'utf8'))
  decipher.setAuthTag(Buffer.from(vault.tag, 'base64'))
  const plain = Buffer.concat([
    decipher.update(Buffer.from(vault.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8')
  const parsed: unknown = JSON.parse(plain)
  if (!isStoredData(parsed)) throw new Error('配置格式无效')
  return parsed
}

function encryptVault(username: string, salt: string, key: Buffer, data: StoredData): UserVault {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(username, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return {
    username,
    salt,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

export class Store {
  private readonly path: string
  private readonly sessionPath: string
  private file: VaultFile | null = null
  private legacyEncoded: string | null = null
  private data: StoredData = emptyData()
  private username: string | null = null
  private salt: string | null = null
  private key: Buffer | null = null
  private unreadable = false
  private session = 0
  private pendingWrite: Promise<void> = Promise.resolve()
  private pendingSessionWrite: Promise<void> = Promise.resolve()

  constructor(directory: string) {
    this.path = join(directory, 'emailagent.enc')
    this.sessionPath = join(directory, 'emailagent.session')
  }

  async load(): Promise<void> {
    let contents: string
    try {
      contents = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    try {
      const parsed: unknown = JSON.parse(contents)
      if (parsed && typeof parsed === 'object' && (parsed as VaultFile).version === 2 &&
          Array.isArray((parsed as VaultFile).users)) {
        this.file = parsed as VaultFile
        return
      }
    } catch {
      // The previous version stored one base64-encoded safeStorage value.
    }
    this.legacyEncoded = contents
  }

  get activeUsername(): string | null {
    return this.username
  }

  get sessionVersion(): number {
    return this.session
  }

  get needsReset(): boolean {
    return this.unreadable
  }

  async restoreSession(): Promise<boolean> {
    let encoded: string
    try {
      encoded = await readFile(this.sessionPath, 'utf8')
    } catch {
      return false
    }
    if (!safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) return false
    let key: Buffer | null = null
    try {
      const session = JSON.parse(encoded) as SavedSession
      if (session.version !== 1 || typeof session.username !== 'string' || typeof session.secret !== 'string') {
        throw new Error('保存的登录状态无效')
      }
      const vault = this.file?.users.find((item) => item.username === session.username)
      if (!vault) throw new Error('用户数据不存在')
      key = Buffer.from(safeStorage.decryptString(Buffer.from(session.secret, 'base64')), 'base64')
      if (key.length !== 32) throw new Error('保存的登录状态无效')
      const data = decryptVault(vault, key)
      this.username = vault.username
      this.salt = vault.salt
      this.key = key
      this.data = data
      return true
    } catch {
      key?.fill(0)
      await this.forgetSession().catch(() => undefined)
      return false
    }
  }

  async forgetSession(): Promise<void> {
    const operation = this.pendingSessionWrite.then(() => rm(this.sessionPath, { force: true }))
    this.pendingSessionWrite = operation.catch(() => undefined)
    await operation
  }

  async login(username: string, password: string): Promise<{ username: string; needsReset: boolean }> {
    this.logout()
    await this.forgetSession()
    const version = this.session
    await this.pendingWrite
    if (this.session !== version) throw new Error('登录状态已变化，请重试')
    const name = username.trim()
    if (this.file) {
      const vault = this.file.users.find((item) => item.username === name)
      if (!vault) throw new Error('账号或密码错误')
      const key = keyFor(password, vault.salt)
      let data: StoredData
      try {
        data = decryptVault(vault, key)
      } catch {
        key.fill(0)
        throw new Error('账号或密码错误')
      }
      this.username = name
      this.salt = vault.salt
      this.key = key
      this.data = data
      const retained = currentConversations(data.agentConversations)
      if (JSON.stringify(retained) !== JSON.stringify(data.agentConversations || [])) {
        await this.setAgentConversations(retained)
      }
      await this.rememberSession().catch(() => undefined)
      return { username: name, needsReset: false }
    }

    if (name !== 'dmc' || password !== '123456') throw new Error('账号或密码错误')
    const salt = randomBytes(16).toString('base64')
    const key = keyFor(password, salt)
    this.username = name
    this.salt = salt
    this.key = key
    if (this.legacyEncoded !== null) {
      try {
        this.data = this.decryptLegacy()
      } catch {
        this.unreadable = true
        return { username: name, needsReset: true }
      }
      await this.backupOriginal()
    }
    await this.save(this.data)
    if (this.session !== version) throw new Error('登录状态已变化，请重试')
    await this.rememberSession().catch(() => undefined)
    return { username: name, needsReset: false }
  }

  logout(): void {
    this.session += 1
    this.key?.fill(0)
    this.key = null
    this.salt = null
    this.username = null
    this.data = emptyData()
    this.unreadable = false
  }

  async addUser(username: string, password: string): Promise<void> {
    this.ensureReady()
    const name = username.trim()
    if (!/^[A-Za-z0-9_]{3,32}$/.test(name)) throw new Error('账号需为 3–32 位字母、数字或下划线')
    if (password.length < 6) throw new Error('密码至少需要 6 位')
    if (!this.file || this.file.users.some((item) => item.username === name)) {
      throw new Error('账号已存在')
    }
    const salt = randomBytes(16).toString('base64')
    const key = keyFor(password, salt)
    const vault = encryptVault(name, salt, key, emptyData())
    key.fill(0)
    await this.persist(vault)
  }

  async changePassword(currentPassword: string, nextPassword: string): Promise<void> {
    this.ensureReady()
    const version = this.session
    if (nextPassword.length < 8) throw new Error('新密码至少需要 8 位')
    const candidate = keyFor(currentPassword, this.salt!)
    const valid = timingSafeEqual(candidate, this.key!)
    candidate.fill(0)
    if (!valid) throw new Error('当前密码错误')
    const salt = randomBytes(16).toString('base64')
    const key = keyFor(nextPassword, salt)
    const vault = encryptVault(this.username!, salt, key, this.data)
    try {
      await this.persist(vault)
    } catch (error) {
      key.fill(0)
      throw error
    }
    if (this.session !== version) {
      key.fill(0)
      return
    }
    this.key!.fill(0)
    this.key = key
    this.salt = salt
    await this.rememberSession().catch(() => undefined)
  }

  async retryUnreadable(): Promise<boolean> {
    if (!this.username || !this.unreadable || this.legacyEncoded === null) return this.unreadable
    const version = this.session
    try {
      const data = this.decryptLegacy()
      await this.backupOriginal()
      await this.save(data, true)
      if (this.session === version) {
        this.data = data
        this.unreadable = false
        await this.rememberSession().catch(() => undefined)
      }
    } catch {
      this.unreadable = true
    }
    return this.unreadable
  }

  async resetUnreadable(): Promise<string> {
    if (!this.username || !this.unreadable || this.legacyEncoded === null) {
      throw new Error('本地数据不需要重建')
    }
    const version = this.session
    const backup = await this.backupOriginal()
    const fresh = emptyData()
    await this.save(fresh, true)
    if (this.session === version) {
      this.data = fresh
      this.unreadable = false
      await this.rememberSession().catch(() => undefined)
    }
    return backup
  }

  get accounts(): StoredAccount[] {
    this.ensureReady()
    return this.data.accounts
  }

  get ai(): AiSettingsInput {
    this.ensureReady()
    return this.data.ai
  }

  get agentConversations(): AgentConversation[] {
    this.ensureReady()
    return currentConversations(this.data.agentConversations || [])
  }

  get themeMode(): ThemeMode {
    this.ensureReady()
    return this.data.themeMode === 'light' || this.data.themeMode === 'dark' ? this.data.themeMode : 'system'
  }

  async setThemeMode(themeMode: ThemeMode): Promise<void> {
    if (themeMode !== 'system' && themeMode !== 'light' && themeMode !== 'dark') throw new Error('主题选项无效')
    const version = this.session
    const next = { ...this.data, themeMode }
    await this.save(next)
    if (this.session === version) this.data = next
  }

  async setAccounts(accounts: StoredAccount[]): Promise<void> {
    const version = this.session
    const next = { ...this.data, accounts }
    await this.save(next)
    if (this.session === version) this.data = next
  }

  async setAi(ai: AiSettingsInput): Promise<void> {
    const version = this.session
    const next = { ...this.data, ai }
    await this.save(next)
    if (this.session === version) this.data = next
  }

  async setAgentConversations(agentConversations: AgentConversation[]): Promise<void> {
    const version = this.session
    const next = { ...this.data, agentConversations: currentConversations(agentConversations) }
    await this.save(next)
    if (this.session === version) this.data = next
  }

  private ensureReady(): void {
    if (!this.username) throw new Error('请先登录')
    if (this.unreadable) throw new Error('本地数据不可读，请先处理旧配置')
  }

  private decryptLegacy(): StoredData {
    if (this.legacyEncoded === null || !safeStorage.isEncryptionAvailable()) {
      throw new Error('旧版安全存储不可用')
    }
    const parsed: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(this.legacyEncoded, 'base64')))
    if (!isStoredData(parsed)) throw new Error('旧版配置格式无效')
    return parsed
  }

  private async backupOriginal(): Promise<string> {
    const backup = `${this.path}.backup-${Date.now()}-${randomUUID()}`
    await copyFile(this.path, backup)
    await chmod(backup, 0o600)
    return backup
  }

  private async rememberSession(): Promise<void> {
    const version = this.session
    const operation = this.pendingSessionWrite.then(async () => {
      if (this.session !== version || !this.username || !this.key || !safeStorage.isEncryptionAvailable() ||
        (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) return
      const session: SavedSession = {
        version: 1,
        username: this.username,
        secret: safeStorage.encryptString(this.key.toString('base64')).toString('base64')
      }
      const temporary = `${this.sessionPath}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(session), { mode: 0o600, flag: 'wx' })
        await chmod(temporary, 0o600)
        if (this.session === version) await rename(temporary, this.sessionPath)
      } finally {
        await rm(temporary, { force: true })
      }
    })
    this.pendingSessionWrite = operation.catch(() => undefined)
    await operation
  }

  private async save(data: StoredData, resetting = false): Promise<void> {
    if (!resetting) this.ensureReady()
    if (!this.username || !this.salt || !this.key) throw new Error('请先登录')
    const vault = encryptVault(this.username, this.salt, this.key, data)
    await this.persist(vault)
    this.legacyEncoded = null
  }

  private async persist(vault: UserVault): Promise<void> {
    const operation = this.pendingWrite.then(async () => {
      const file: VaultFile = {
        version: 2,
        users: [...(this.file?.users.filter((item) => item.username !== vault.username) || []), vault]
      }
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(file), { mode: 0o600, flag: 'wx' })
        await chmod(temporary, 0o600)
        await rename(temporary, this.path)
      } finally {
        await rm(temporary, { force: true })
      }
      this.file = file
    })
    this.pendingWrite = operation.catch(() => {})
    await operation
  }
}
