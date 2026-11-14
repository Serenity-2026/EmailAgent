import { describe, expect, it } from 'vitest'
import { API_CHANNELS, validateRpc } from './api'

describe('RPC request validation', () => {
  it('keeps every declared channel covered by the validator', () => {
    const validArguments: Record<(typeof API_CHANNELS)[number], unknown[]> = {
      'auth:bootstrap-status': [], 'auth:bootstrap': ['admin', 'password'],
      'auth:session': [], 'auth:login': ['dmc', 'password'], 'auth:logout': [],
      'auth:create': ['student', 'password'], 'auth:password': ['old-password', 'new-password'],
      'accounts:list': [], 'accounts:add': [{ provider: 'qq', address: 'student@qq.com', authorizationCode: 'code' }],
      'accounts:remove': ['account'], 'accounts:update-authorization': ['account', 'new-code'], 'accounts:health': ['account'],
      'mail:folders': ['account'],
      'mail:list': ['account', 'INBOX', { limit: 50, query: {} }], 'mail:get': ['account', 'INBOX', 1, false],
      'mail:attachment': ['account', 'INBOX', 1, '55', 'attachment-1'],
      'mail:sent-folder': ['account'], 'mail:send': [{ accountId: 'account', to: ['one@example.com'], cc: [], bcc: [], subject: '主题', text: '正文' }],
      'drafts:list': [], 'drafts:save': ['', { accountId: 'account', to: [], cc: [], bcc: [], subject: '草稿', text: '正文' }],
      'drafts:remove': ['draft'],
      'ai:settings:get': [], 'ai:models': ['https://example.com/v1', 'key'],
      'ai:settings:save': [{ baseUrl: 'https://example.com/v1', model: 'model', apiKey: 'key', dailyTime: '09:00', autoDaily: false }],
      'ai:settings:test': [], 'ai:draft': ['写一封邮件', 'account'], 'ai:digest': [['account']], 'ai:digest:history': [],
      'ai:activity:clear': [],
      'agent:history': [], 'agent:overview': [],
      'agent:run': ['总结邮件', '', '123e4567-e89b-42d3-a456-426614174000'],
      'agent:cancel': ['123e4567-e89b-42d3-a456-426614174000'], 'agent:confirm': ['proposal'],
      'agent:clear': [], 'theme:get': [], 'theme:set': ['dark']
    }
    expect(Object.keys(validArguments).sort()).toEqual([...API_CHANNELS].sort())
    for (const channel of API_CHANNELS) expect(() => validateRpc(channel, validArguments[channel])).not.toThrow()
  })

  it('rejects extra arguments, invalid UIDs and oversized bounded inputs', () => {
    expect(() => validateRpc('auth:session', ['extra'])).toThrow('请求参数无效')
    expect(() => validateRpc('mail:get', ['account', 'INBOX', 0])).toThrow('请求参数无效')
    expect(() => validateRpc('mail:attachment', ['account', 'INBOX', 0, '55', 'attachment-1'])).toThrow('请求参数无效')
    expect(() => validateRpc('mail:list', ['account', 'INBOX', { limit: 51 }])).toThrow('请求参数无效')
    expect(() => validateRpc('mail:list', ['account', 'INBOX', { query: { since: 'yesterday' } }])).toThrow('请求参数无效')
    expect(() => validateRpc('accounts:update-authorization', ['account', 'x'.repeat(2001)])).toThrow('请求参数无效')
    expect(() => validateRpc('drafts:save', ['', { accountId: 'account', to: [], cc: [], bcc: [], subject: '', text: 'x'.repeat(1_000_001) }])).toThrow('请求参数无效')
    expect(() => validateRpc('mail:send', [{ accountId: 'account', to: Array(51).fill('one@example.com'), cc: [], bcc: [], subject: '主题', text: '正文' }])).toThrow('请求参数无效')
    expect(() => validateRpc('agent:run', ['x'.repeat(10_001)])).toThrow('请求参数无效')
    expect(() => validateRpc('agent:run', ['总结邮件', '', 'not-a-job-id'])).toThrow('请求参数无效')
    expect(() => validateRpc('ai:digest', [Array.from({ length: 101 }, () => 'account')])).toThrow('请求参数无效')
  })

  it('accepts an optional overview refresh flag', () => {
    expect(() => validateRpc('agent:overview', [])).not.toThrow()
    expect(() => validateRpc('agent:overview', [{ force: true }])).not.toThrow()
    expect(() => validateRpc('agent:overview', [{ force: 'yes' }])).toThrow('请求参数无效')
    expect(() => validateRpc('agent:overview', [{}, 'extra'])).toThrow('请求参数无效')
  })

  it('validates the sensitive mail policy values', () => {
    const base = { baseUrl: 'https://example.com/v1', model: 'model', apiKey: 'key', dailyTime: '09:00', autoDaily: false }
    expect(() => validateRpc('ai:settings:save', [{ ...base, privacy: { code: 'mask', finance: 'block', identity: 'allow' } }])).not.toThrow()
    expect(() => validateRpc('ai:settings:save', [{ ...base, privacy: { code: 'encrypt' } }])).toThrow('请求参数无效')
    expect(() => validateRpc('ai:settings:save', [{ ...base, privacy: ['block'] }])).toThrow('请求参数无效')
  })

  it('accepts a reply identity only when all nested values are valid', () => {
    const draft = { accountId: 'account', to: ['one@example.com'], cc: [], bcc: [], subject: '回复', text: '正文',
      replyTo: { uid: 7, folder: 'INBOX', uidValidity: '22' } }
    expect(() => validateRpc('mail:send', [draft])).not.toThrow()
    expect(() => validateRpc('mail:send', [{ ...draft, replyTo: { ...draft.replyTo, uid: -1 } }])).toThrow('请求参数无效')
  })
})
