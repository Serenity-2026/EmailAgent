import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AgentConversation, AiSettingsInput, ThemeMode } from '../shared/models'
import { currentConversations, decryptVault, emptyData, encryptVault, keyFor, type StoredAccount, type StoredData } from '../shared/vault'
import { Database } from './database'

export class MysqlStore {
  private version = 0
  private active = true
  private constructor(private readonly db: Database, readonly username: string,
    private key: Buffer, private salt: string, private data: StoredData, private revision: number) {}

  static async login(db: Database, username: string, password: string): Promise<MysqlStore> {
    const user = await db.user(username.trim())
    if (!user) throw new Error('账号或密码错误')
    const key = keyFor(password, user.vault.salt)
    try {
      return new MysqlStore(db, user.vault.username, key, user.vault.salt, decryptVault(user.vault, key), user.revision)
    } catch { key.fill(0); throw new Error('账号或密码错误') }
  }

  static async bootstrap(db: Database, username: string, password: string): Promise<MysqlStore> {
    const name = username.trim()
    if (!/^[A-Za-z0-9_]{3,32}$/.test(name)) throw new Error('账号需为 3–32 位字母、数字或下划线')
    if (password.length < 8) throw new Error('初始密码至少需要 8 位')
    const salt = randomBytes(16).toString('base64')
    const key = keyFor(password, salt)
    const data = emptyData()
    try {
      await db.bootstrapUser(encryptVault(name, salt, key, data))
      return new MysqlStore(db, name, key, salt, data, 0)
    } catch (error) {
      key.fill(0)
      throw error
    }
  }

  static async restore(db: Database, username: string, key: Buffer): Promise<MysqlStore> {
    const user = await db.user(username)
    if (!user) { key.fill(0); throw new Error('登录状态已失效，请重新登录') }
    try { return new MysqlStore(db, username, key, user.vault.salt, decryptVault(user.vault, key), user.revision) }
    catch { key.fill(0); throw new Error('登录状态已失效，请重新登录') }
  }

  get activeUsername(): string | null { return this.active ? this.username : null }
  get sessionVersion(): number { return this.version }
  get accounts(): StoredAccount[] { this.ensureReady(); return this.data.accounts }
  get ai(): AiSettingsInput { this.ensureReady(); return this.data.ai }
  get agentConversations(): AgentConversation[] { this.ensureReady(); return currentConversations(this.data.agentConversations) }
  get themeMode(): ThemeMode { this.ensureReady(); return this.data.themeMode === 'dark' || this.data.themeMode === 'light' ? this.data.themeMode : 'system' }

  async createSession(): Promise<string> { this.ensureReady(); return this.db.createSession(this.username, this.key) }
  logout(): void { this.active = false; this.version++; this.key.fill(0); this.data = emptyData() }
  private ensureReady(): void { if (!this.active) throw new Error('登录状态已变化，请重新登录') }

  async refresh(): Promise<void> {
    this.ensureReady()
    const user = await this.db.user(this.username)
    this.ensureReady()
    if (!user || user.vault.salt !== this.salt) throw new Error('登录状态已失效，请重新登录')
    if (user.revision !== this.revision) {
      this.data = decryptVault(user.vault, this.key)
      this.revision = user.revision
    }
  }

  private async save(data: StoredData): Promise<void> {
    this.ensureReady()
    const version = this.version
    await this.db.save(encryptVault(this.username, this.salt, this.key, data), this.revision)
    if (version === this.version) { this.data = data; this.revision++ }
  }
  async setAccounts(accounts: StoredAccount[]): Promise<void> { await this.save({ ...this.data, accounts }) }
  async setAi(ai: AiSettingsInput): Promise<void> { await this.save({ ...this.data, ai }) }
  async setAgentConversations(items: AgentConversation[]): Promise<void> { await this.save({ ...this.data, agentConversations: currentConversations(items) }) }
  async setThemeMode(mode: ThemeMode): Promise<void> {
    if (mode !== 'system' && mode !== 'light' && mode !== 'dark') throw new Error('主题选项无效')
    await this.save({ ...this.data, themeMode: mode })
  }
  async addUser(username: string, password: string): Promise<void> {
    this.ensureReady()
    const name = username.trim()
    if (!/^[A-Za-z0-9_]{3,32}$/.test(name)) throw new Error('账号需为 3–32 位字母、数字或下划线')
    if (password.length < 6) throw new Error('密码至少需要 6 位')
    const salt = randomBytes(16).toString('base64')
    const key = keyFor(password, salt)
    try { await this.db.addUser(encryptVault(name, salt, key, emptyData())) } finally { key.fill(0) }
  }
  async changePassword(current: string, next: string, token: string): Promise<void> {
    this.ensureReady()
    const version = this.version
    if (next.length < 8) throw new Error('新密码至少需要 8 位')
    const candidate = keyFor(current, this.salt)
    const valid = timingSafeEqual(candidate, this.key)
    candidate.fill(0)
    if (!valid) throw new Error('当前密码错误')
    const salt = randomBytes(16).toString('base64')
    const key = keyFor(next, salt)
    try { await this.db.changePassword(encryptVault(this.username, salt, key, this.data), this.revision, token, key) }
    catch (error) { key.fill(0); throw error }
    if (version !== this.version) { key.fill(0); return }
    this.key.fill(0); this.key = key; this.salt = salt; this.revision++
  }
}
