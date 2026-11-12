import { afterEach, describe, expect, it, vi } from 'vitest'
import { complete, listAiModels, parseGeneratedDraft, resolveAiKey, validateAiSettings } from './ai'

afterEach(() => vi.unstubAllGlobals())

describe('AI input and output boundaries', () => {
  it('rejects non-HTTPS AI endpoints', () => {
    expect(() => validateAiSettings({
      baseUrl: 'http://example.com/v1', model: 'example', apiKey: 'key', dailyTime: '09:00', autoDaily: false
    })).toThrow()
  })

  it('keeps missing recipients empty for manual completion', () => {
    const draft = parseGeneratedDraft('{"to":"","subject":"会议","text":"明天下午见。"}', 'account-1', [])
    expect(draft.to).toEqual([])
    expect(draft.cc).toEqual([])
    expect(draft.bcc).toEqual([])
    expect(draft.accountId).toBe('account-1')
  })

  it('rejects malformed recipient addresses from a model', () => {
    expect(() => parseGeneratedDraft('{"to":"张三","subject":"会议","text":"明天下午见。"}', 'account-1', [])).toThrow()
  })

  it('clears an address the user did not provide', () => {
    const draft = parseGeneratedDraft('{"to":"other@example.com","subject":"会议","text":"明天下午见。"}',
      'account-1', ['teacher@example.com'])
    expect(draft.to).toEqual([])
  })

  it('accepts a JSON code block returned by a model', () => {
    const draft = parseGeneratedDraft('```json\n{"to":"teacher@example.com","subject":"报告","text":"周五提交。"}\n```',
      'account-1', ['teacher@example.com'])
    expect(draft.to).toEqual(['teacher@example.com'])
  })

  it('accepts structured to/cc/bcc arrays but removes addresses absent from the instruction', () => {
    const draft = parseGeneratedDraft(JSON.stringify({
      to: ['one@example.com'], cc: ['two@example.com'], bcc: ['hidden@example.com'], subject: '通知', text: '正文'
    }), 'account-1', ['one@example.com', 'two@example.com'])
    expect(draft).toMatchObject({ to: ['one@example.com'], cc: ['two@example.com'], bcc: [] })
  })

  it('loads model choices from the configured provider without saving its key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'model-b' }, { id: 'model-a' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await listAiModels('https://example.com/v1/', 'test-key')).toEqual(['model-a', 'model-b'])
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/v1/models', expect.objectContaining({
      headers: { Authorization: 'Bearer test-key' }
    }))
  })

  it('does not reuse a saved API key when the service address changes', () => {
    const saved = { baseUrl: 'https://first.example/v1', model: 'a', apiKey: 'saved-key', dailyTime: '09:00', autoDaily: false }
    expect(resolveAiKey('https://first.example/v1/', '', saved)).toBe('saved-key')
    expect(resolveAiKey('https://second.example/v1', '', saved)).toBe('')
  })

  it('aborts an in-flight model request with the Agent job signal', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))))
    const running = complete({
      baseUrl: 'https://example.com/v1', model: 'test', apiKey: 'key', dailyTime: '09:00', autoDaily: false
    }, 'system', 'user', controller.signal)
    controller.abort()
    await expect(running).rejects.toThrow('aborted')
  })
})
