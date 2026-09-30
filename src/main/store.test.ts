import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cryptoState = vi.hoisted(() => ({ failNextRead: false, available: true }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => cryptoState.available,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => {
      if (cryptoState.failNextRead) {
        cryptoState.failNextRead = false
        throw new Error('BAD_DECRYPT')
      }
      if (value.toString() === 'bad-ciphertext') throw new Error('BAD_DECRYPT')
      return value.toString()
    }
  }
}))

import { Store } from './store'

const directories: string[] = []
const legacyData = {
  accounts: [{ id: 'one', provider: 'qq' as const, address: 'test@qq.com', authorizationCode: 'example-code' }],
  ai: { baseUrl: '', model: '', apiKey: '', dailyTime: '09:00', autoDaily: false }
}

async function fixture(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'emailagent-store-'))
  directories.push(directory)
  return { directory, path: join(directory, 'emailagent.enc') }
}

afterEach(async () => {
  cryptoState.failNextRead = false
  cryptoState.available = true
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('local user vault', () => {
  it('restores the signed-in user after restart and forgets the session on logout', async () => {
    const { directory } = await fixture()
    const original = new Store(directory)
    await original.load()
    await original.login('dmc', '123456')
    await original.setAccounts(legacyData.accounts)
    const savedSession = await readFile(join(directory, 'emailagent.session'), 'utf8')
    expect(savedSession).not.toContain('123456')
    expect(savedSession).not.toContain('example-code')
    expect((await stat(join(directory, 'emailagent.session'))).mode & 0o777).toBe(0o600)

    const reopened = new Store(directory)
    await reopened.load()
    expect(await reopened.restoreSession()).toBe(true)
    expect(reopened.activeUsername).toBe('dmc')
    expect(reopened.accounts[0].address).toBe('test@qq.com')
    await reopened.forgetSession()
    reopened.logout()

    const afterLogout = new Store(directory)
    await afterLogout.load()
    expect(await afterLogout.restoreSession()).toBe(false)
    expect(afterLogout.activeUsername).toBeNull()
  })

  it('falls back to password login when a saved session cannot be decrypted', async () => {
    const { directory } = await fixture()
    const original = new Store(directory)
    await original.load()
    await original.login('dmc', '123456')
    await original.setAccounts(legacyData.accounts)

    cryptoState.failNextRead = true
    const reopened = new Store(directory)
    await reopened.load()
    expect(await reopened.restoreSession()).toBe(false)
    expect(reopened.activeUsername).toBeNull()
    await reopened.login('dmc', '123456')
    expect(reopened.accounts[0].address).toBe('test@qq.com')
  })

  it('does not save a session when system encryption is unavailable', async () => {
    const { directory } = await fixture()
    cryptoState.available = false
    const store = new Store(directory)
    await store.load()
    await store.login('dmc', '123456')
    const reopened = new Store(directory)
    await reopened.load()
    expect(await reopened.restoreSession()).toBe(false)
    expect(reopened.activeUsername).toBeNull()
  })

  it('requires login and keeps the mailbox credential out of plaintext storage', async () => {
    const { directory, path } = await fixture()
    const store = new Store(directory)
    await store.load()
    expect(() => store.accounts).toThrow('请先登录')
    await expect(store.login('dmc', 'wrong')).rejects.toThrow('账号或密码错误')
    await store.login('dmc', '123456')
    await store.setAccounts(legacyData.accounts)
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toContain('example-code')
    expect(raw).not.toContain('123456')

    store.logout()
    expect(() => store.accounts).toThrow('请先登录')
    const reopened = new Store(directory)
    await reopened.load()
    await expect(reopened.login('dmc', 'wrong')).rejects.toThrow('账号或密码错误')
    await reopened.login('dmc', '123456')
    expect(reopened.accounts[0].address).toBe('test@qq.com')
  })

  it('migrates readable legacy mail and AI settings with an unchanged backup', async () => {
    const { directory, path } = await fixture()
    const original = Buffer.from(JSON.stringify(legacyData)).toString('base64')
    await writeFile(path, original)
    const store = new Store(directory)
    await store.load()
    await store.login('dmc', '123456')
    expect(store.accounts[0].authorizationCode).toBe('example-code')
    const backups = (await readdir(directory)).filter((name) => name.includes('.backup-'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(directory, backups[0]), 'utf8')).toBe(original)
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(2)
    expect(store.agentConversations).toEqual([])
  })

  it('encrypts Agent history per user and drops conversations older than 30 days', async () => {
    const { directory, path } = await fixture()
    const store = new Store(directory)
    await store.load()
    await store.login('dmc', '123456')
    const recent = new Date().toISOString()
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    await store.setAgentConversations([
      { id: 'recent', updatedAt: recent, messages: [
        { id: 'm0', role: 'user', content: '过期消息', createdAt: old },
        { id: 'm1', role: 'user', content: '帮我找课程邮件', createdAt: recent }
      ] },
      { id: 'old', updatedAt: old, messages: [{ id: 'm2', role: 'user',
        content: '过期对话', createdAt: old }] }
    ])
    expect(store.agentConversations.map((item) => item.id)).toEqual(['recent'])
    expect(store.agentConversations[0].messages.map((item) => item.id)).toEqual(['m1'])
    expect(await readFile(path, 'utf8')).not.toContain('帮我找课程邮件')
    await store.addUser('other', 'secret-123')
    store.logout()
    await store.login('other', 'secret-123')
    expect(store.agentConversations).toEqual([])
    store.logout()
    await store.login('dmc', '123456')
    expect(store.agentConversations[0].messages[0].content).toBe('帮我找课程邮件')
  })

  it('keeps unreadable legacy data until the user chooses a backup and reset', async () => {
    const { directory, path } = await fixture()
    const original = Buffer.from('bad-ciphertext').toString('base64')
    await writeFile(path, original)
    const store = new Store(directory)
    await store.load()
    expect((await store.login('dmc', '123456')).needsReset).toBe(true)
    await expect(store.setAccounts([])).rejects.toThrow('本地数据不可读')
    expect(await readFile(path, 'utf8')).toBe(original)
    const backup = await store.resetUnreadable()
    expect(await readFile(backup, 'utf8')).toBe(original)
    expect(store.needsReset).toBe(false)
    expect(store.accounts).toEqual([])
  })

  it('retries a transient legacy decryption error without losing the mailbox', async () => {
    const { directory, path } = await fixture()
    await writeFile(path, Buffer.from(JSON.stringify(legacyData)).toString('base64'))
    cryptoState.failNextRead = true
    const store = new Store(directory)
    await store.load()
    expect((await store.login('dmc', '123456')).needsReset).toBe(true)
    expect(await store.retryUnreadable()).toBe(false)
    expect(store.accounts[0].address).toBe('test@qq.com')
  })

  it('keeps mailboxes and AI settings separate for each local user', async () => {
    const { directory } = await fixture()
    const store = new Store(directory)
    await store.load()
    await store.login('dmc', '123456')
    await store.setAccounts(legacyData.accounts)
    await store.setThemeMode('dark')
    await store.addUser('other', 'secret-123')
    store.logout()
    await store.login('other', 'secret-123')
    expect(store.accounts).toEqual([])
    expect(store.themeMode).toBe('system')
    await store.setAi({ ...legacyData.ai, model: 'other-model' })
    store.logout()
    await store.login('dmc', '123456')
    expect(store.accounts[0].address).toBe('test@qq.com')
    expect(store.ai.model).toBe('')
    expect(store.themeMode).toBe('dark')
    store.logout()
    await store.login('other', 'secret-123')
    expect(store.ai.model).toBe('other-model')
  })

  it('changes the login password while preserving the current user data', async () => {
    const { directory } = await fixture()
    const store = new Store(directory)
    await store.load()
    await store.login('dmc', '123456')
    await store.setAccounts(legacyData.accounts)
    await expect(store.changePassword('wrong', 'new-password')).rejects.toThrow('当前密码错误')
    await store.changePassword('123456', 'new-password')
    const reopened = new Store(directory)
    await reopened.load()
    expect(await reopened.restoreSession()).toBe(true)
    expect(reopened.accounts[0].address).toBe('test@qq.com')
    store.logout()
    await expect(store.login('dmc', '123456')).rejects.toThrow('账号或密码错误')
    await store.login('dmc', 'new-password')
    expect(store.accounts[0].address).toBe('test@qq.com')
  })

  it('does not restore a previous user into memory when a pending save finishes after logout', async () => {
    const { directory } = await fixture()
    const store = new Store(directory)
    await store.load()
    await store.login('dmc', '123456')
    const pending = store.setAccounts(legacyData.accounts)
    store.logout()
    await pending
    expect(() => store.accounts).toThrow('请先登录')
    await store.login('dmc', '123456')
    expect(store.accounts[0].address).toBe('test@qq.com')
  })
})
