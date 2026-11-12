import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

import { BackendClient } from './backend-client'

afterEach(() => vi.unstubAllGlobals())

describe('desktop backend metadata', () => {
  it('reports the desktop IANA time zone on RPC requests', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ result: { username: null } }) }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new BackendClient('unused', () => undefined, 'http://127.0.0.1:3210')
    await client.request('auth:session')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('auth%3Asession'), expect.objectContaining({
      headers: expect.objectContaining({ 'X-EmailAgent-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })
    }))
  })
})
