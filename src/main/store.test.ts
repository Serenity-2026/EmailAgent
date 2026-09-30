import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cryptoState = vi.hoisted(() => ({ failNextRead: false }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
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

afterEach(async () => {
  cryptoState.failNextRead = false
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('encrypted local store recovery', () => {
  it('keeps an unreadable file untouched until backup and reset are chosen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emailagent-store-'))
    directories.push(directory)
    const path = join(directory, 'emailagent.enc')
    const original = Buffer.from('bad-ciphertext').toString('base64')
    await writeFile(path, original)

    const store = new Store(directory)
    await store.load()
    expect(store.needsReset).toBe(true)
    await expect(store.setAccounts([])).rejects.toThrow('本地数据不可读')
    expect(await readFile(path, 'utf8')).toBe(original)

    const backup = await store.resetUnreadable()
    expect(await readFile(backup, 'utf8')).toBe(original)
    expect(store.needsReset).toBe(false)
    const reopened = new Store(directory)
    await reopened.load()
    expect(reopened.needsReset).toBe(false)
    expect(reopened.accounts).toEqual([])
  })

  it('can retry a temporary decryption failure without resetting data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emailagent-store-'))
    directories.push(directory)
    const path = join(directory, 'emailagent.enc')
    const original = Buffer.from(JSON.stringify({
      accounts: [{ id: 'one', provider: 'qq', address: 'test@qq.com', authorizationCode: 'example' }],
      ai: { baseUrl: '', model: '', apiKey: '', dailyTime: '09:00', autoDaily: false }
    })).toString('base64')
    await writeFile(path, original)
    cryptoState.failNextRead = true

    const store = new Store(directory)
    await store.load()
    expect(store.needsReset).toBe(true)
    await store.load()
    expect(store.needsReset).toBe(false)
    expect(store.accounts[0].address).toBe('test@qq.com')
    expect(await readFile(path, 'utf8')).toBe(original)
  })
})
