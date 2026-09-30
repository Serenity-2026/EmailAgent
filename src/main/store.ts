import { readFile, writeFile, rename, chmod } from 'node:fs/promises'
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

  constructor(directory: string) {
    this.path = join(directory, 'emailagent.enc')
  }

  async load(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法保存邮箱授权码')
    }
    try {
      const encoded = await readFile(this.path, 'utf8')
      this.data = JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64'))) as StoredData
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  get accounts(): StoredAccount[] {
    return this.data.accounts
  }

  get ai(): AiSettingsInput {
    return this.data.ai
  }

  async setAccounts(accounts: StoredAccount[]): Promise<void> {
    this.data.accounts = accounts
    await this.save()
  }

  async setAi(ai: AiSettingsInput): Promise<void> {
    this.data.ai = ai
    await this.save()
  }

  private async save(): Promise<void> {
    const encrypted = safeStorage.encryptString(JSON.stringify(this.data)).toString('base64')
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, encrypted, { mode: 0o600 })
    await chmod(temporary, 0o600)
    await rename(temporary, this.path)
  }
}
