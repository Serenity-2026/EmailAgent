import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMailRef } from '../shared/models'
import type { StoredAccount } from '../shared/vault'

vi.mock('./ai', () => ({ complete: vi.fn() }))
vi.mock('./mail', () => ({ searchAgentMail: vi.fn(), readAgentMailBatch: vi.fn() }))

import { complete } from './ai'
import { readAgentMailBatch, searchAgentMail } from './mail'
import { getMailOverview, parseOverviewTopics } from './mail-overview'

const account: StoredAccount = { id: 'qq', address: 'student@qq.com', provider: 'qq', authorizationCode: 'test' }
const settings = { baseUrl: 'https://ai.example/v1', apiKey: 'key', model: 'test', dailyTime: '09:00', autoDaily: false }
const mail = (uid: number, folder: string, from: string, to: string[] = []): AgentMailRef => ({
  uid, folder, from, to, accountId: account.id, accountAddress: account.address, uidValidity: '1',
  subject: `课程邮件 ${uid}`, date: '2026-09-29T00:00:00.000Z', unread: true
})

beforeEach(() => vi.resetAllMocks())

describe('recent mailbox overview', () => {
  it('counts received and sent mail, including the most frequent people', async () => {
    vi.mocked(searchAgentMail).mockResolvedValue({ matches: [
      mail(1, 'INBOX', '老师 <teacher@example.com>'),
      mail(2, 'INBOX', 'teacher@example.com'),
      mail(3, 'Sent', 'student@qq.com', ['classmate@example.com'])
    ], searchedFolders: ['INBOX', 'Sent'], truncated: false, warnings: [], counts: { inbox: 2, sent: 1 } })
    vi.mocked(readAgentMailBatch).mockImplementation(async (_account, refs) => refs.map((ref) => ({ mail: ref, text: '课程报告' })))
    vi.mocked(complete).mockResolvedValue('{"topics":[{"name":"课程","mailNumbers":[1,2]},{"name":"通知","mailNumbers":[]},{"name":"其他","mailNumbers":[3]}]}')
    const overview = await getMailOverview([account], settings)
    expect(overview.received).toBe(2)
    expect(overview.sent).toBe(1)
    expect(overview.topSenders[0]).toEqual({ address: 'teacher@example.com', count: 2 })
    expect(overview.topRecipients[0]).toEqual({ address: 'classmate@example.com', count: 1 })
    expect(overview.topics.map((item) => item.count)).toEqual([2, 0, 1])
    expect(JSON.parse(vi.mocked(complete).mock.calls[0][2] as string)[0].text).toBe('课程报告')
  })

  it('keeps counts available without AI and labels capped searches as sampled', async () => {
    vi.mocked(searchAgentMail).mockResolvedValue({ matches: [mail(1, 'INBOX', 'teacher@example.com')],
      searchedFolders: ['INBOX'], truncated: true, warnings: [], counts: { inbox: 123, sent: 2 } })
    const overview = await getMailOverview([account], { ...settings, apiKey: '' })
    expect(overview.sampled).toBe(true)
    expect(overview.received).toBe(123)
    expect(overview.sent).toBe(2)
    expect(overview.topSenders).toEqual([{ address: 'teacher@example.com', count: 1 }])
    expect(overview.topics).toEqual([])
    expect(complete).not.toHaveBeenCalled()
  })

  it('returns an empty overview when no recent mail matches', async () => {
    vi.mocked(searchAgentMail).mockResolvedValue({ matches: [], searchedFolders: ['INBOX', 'Sent'],
      truncated: false, warnings: [], counts: { inbox: 0, sent: 0 } })
    const overview = await getMailOverview([account], settings)
    expect(overview.received).toBe(0)
    expect(overview.sent).toBe(0)
    expect(overview.topics).toEqual([])
    expect(readAgentMailBatch).not.toHaveBeenCalled()
  })

  it('rejects invented mail numbers in model topic classifications', () => {
    expect(() => parseOverviewTopics('{"topics":[{"name":"课程","mailNumbers":[2]},{"name":"通知","mailNumbers":[]},{"name":"其他","mailNumbers":[]}]}', 1))
      .toThrow('引用')
  })

  it('does not return overview data after logout during model analysis', async () => {
    let active = true
    vi.mocked(searchAgentMail).mockResolvedValue({ matches: [mail(1, 'INBOX', 'teacher@example.com')],
      searchedFolders: ['INBOX'], truncated: false, warnings: [], counts: { inbox: 1, sent: 0 } })
    vi.mocked(readAgentMailBatch).mockResolvedValue([{ mail: mail(1, 'INBOX', 'teacher@example.com'), text: '报告' }])
    vi.mocked(complete).mockImplementation(async () => { active = false; return '{"topics":[]}' })
    await expect(getMailOverview([account], settings, () => {
      if (!active) throw new Error('登录状态已变化')
    })).rejects.toThrow('登录状态已变化')
  })
})
