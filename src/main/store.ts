import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, chmod, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { Account, AiSettingsInput } from '../shared/models'

export interface StoredAccount extends Account {
  authorizationCode: string
}

interface StoredData {
  accounts: StoredAccount[]
  ai: AiSettingsInput
}

const emptyData = (): StoredData => ({
  accounts: [],
  ai: { baseUrl: '', model: '', apiKey: '', dailyTime: '09:00', autoDaily: false }
})

export class Store {
  private readonly path: string
  private data: StoredData = emptyData()
  private unreadable = false

  constructor(directory: string) {
    this.path = join(directory, 'emailagent.enc')
  }

  async load(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法保存邮箱授权码')
    }
    let encoded: string
    try {
      encoded = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.data = emptyData()
        this.unreadable = false
        return
      }
      throw error
    }
    try {
      this.data = JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64'))) as StoredData
      this.unreadable = false
    } catch {
      this.unreadable = true
    }
  }

  get needsReset(): boolean {
    return this.unreadable
  }

  async resetUnreadable(): Promise<string> {
    if (!this.unreadable) throw new Error('本地数据不需要重建')
    const backup = `${this.path}.backup-${Date.now()}-${randomUUID()}`
    await copyFile(this.path, backup)
    await chmod(backup, 0o600)
    const fresh = emptyData()
    await this.save(fresh, true)
    this.data = fresh
    this.unreadable = false
    return backup
  }

  get accounts(): StoredAccount[] {
    return this.data.accounts
  }

  get ai(): AiSettingsInput {
    return this.data.ai
  }

  async setAccounts(accounts: StoredAccount[]): Promise<void> {
    const next = { ...this.data, accounts }
    await this.save(next)
    this.data = next
  }

  async setAi(ai: AiSettingsInput): Promise<void> {
    const next = { ...this.data, ai }
    await this.save(next)
    this.data = next
  }

  private async save(data: StoredData, resetting = false): Promise<void> {
    if (this.unreadable && !resetting) throw new Error('本地数据不可读，请先重建配置')
    const encrypted = safeStorage.encryptString(JSON.stringify(data)).toString('base64')
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, encrypted, { mode: 0o600 })
    await chmod(temporary, 0o600)
    await rename(temporary, this.path)
  }
}
