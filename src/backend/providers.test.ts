import { describe, expect, it } from 'vitest'
import { PROVIDERS, validateAccount, validateRecipient } from './providers'

describe('mail provider configuration', () => {
  it('uses encrypted IMAP and SMTP endpoints for both providers', () => {
    expect(PROVIDERS.qq).toEqual({ domain: 'qq.com', imap: 'imap.qq.com', smtp: 'smtp.qq.com' })
    expect(PROVIDERS['163']).toEqual({ domain: '163.com', imap: 'imap.163.com', smtp: 'smtp.163.com' })
  })

  it('rejects a mismatched mailbox and missing authorization code', () => {
    expect(() => validateAccount({ provider: 'qq', address: 'a@163.com', authorizationCode: 'x' })).toThrow()
    expect(() => validateAccount({ provider: '163', address: 'a@163.com', authorizationCode: '' })).toThrow()
  })

  it('requires a full recipient address before sending', () => {
    expect(() => validateRecipient('张三')).toThrow()
    expect(() => validateRecipient('teacher@example.com')).not.toThrow()
  })
})
