import { describe, expect, it } from 'vitest'
import { currentDigestHistory, currentSavedDrafts } from './vault'

describe('encrypted digest history boundary', () => {
  it('keeps seven days, deduplicates automatic days and strips source body fields', () => {
    const now = Date.parse('2026-11-11T12:00:00.000Z')
    const source = {
      uid: 7, accountId: 'account', folder: 'INBOX', from: 'teacher@example.com', subject: '课程',
      date: '2026-11-11T08:00:00.000Z', unread: true, text: '不得持久化的正文', html: '<p>正文</p>'
    }
    const recent = { date: '2026-11-11', generatedAt: '2026-11-11T10:00:00.000Z', mode: 'auto',
      content: '新摘要', sources: [source], warnings: [] }
    const duplicate = { ...recent, generatedAt: '2026-11-11T09:00:00.000Z', content: '旧摘要' }
    const expired = { ...recent, date: '2026-11-01', generatedAt: '2026-11-01T10:00:00.000Z' }
    const history = currentDigestHistory([duplicate, expired, recent], now)
    expect(history).toHaveLength(1)
    expect(history[0].content).toBe('新摘要')
    expect(history[0].sources[0]).not.toHaveProperty('text')
    expect(history[0].sources[0]).not.toHaveProperty('html')
  })
})

describe('encrypted saved draft boundary', () => {
  it('validates fields, deduplicates ids and keeps only the latest twenty drafts', () => {
    const drafts = Array.from({ length: 22 }, (_, index) => ({
      id: `draft-${index}`, updatedAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      draft: { accountId: 'account', to: 'teacher@example.com', subject: `主题 ${index}`, text: `正文 ${index}` }
    }))
    const sanitized = currentSavedDrafts([
      { ...drafts[21], draft: { ...drafts[21].draft, text: 'x'.repeat(1_000_001) } },
      ...drafts,
      { ...drafts[20], draft: { ...drafts[20].draft, text: '重复旧值' } }
    ])
    expect(sanitized).toHaveLength(20)
    expect(sanitized[0].id).toBe('draft-21')
    expect(new Set(sanitized.map((item) => item.id)).size).toBe(20)
    expect(sanitized.at(-1)?.id).toBe('draft-2')
  })
})
