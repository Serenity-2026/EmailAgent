import { describe, expect, it } from 'vitest'
import { parseGeneratedDraft, validateAiSettings } from './ai'

describe('AI input and output boundaries', () => {
  it('rejects non-HTTPS AI endpoints', () => {
    expect(() => validateAiSettings({
      baseUrl: 'http://example.com/v1', model: 'example', apiKey: 'key', dailyTime: '09:00', autoDaily: false
    })).toThrow()
  })

  it('keeps missing recipients empty for manual completion', () => {
    const draft = parseGeneratedDraft('{"to":"","subject":"会议","text":"明天下午见。"}', 'account-1', [])
    expect(draft.to).toBe('')
    expect(draft.accountId).toBe('account-1')
  })

  it('rejects malformed recipient addresses from a model', () => {
    expect(() => parseGeneratedDraft('{"to":"张三","subject":"会议","text":"明天下午见。"}', 'account-1', [])).toThrow()
  })

  it('clears an address the user did not provide', () => {
    const draft = parseGeneratedDraft('{"to":"other@example.com","subject":"会议","text":"明天下午见。"}',
      'account-1', ['teacher@example.com'])
    expect(draft.to).toBe('')
  })
})
