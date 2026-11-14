import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversation, AgentProgress, AiActivityEntry, AiSettingsInput, DigestHistoryItem, MailDetail, SavedDraft } from '../shared/models'
import type { StoredAccount } from '../shared/vault'
import type { MysqlStore } from './store'

vi.mock('./agent', () => ({ runAgentTask: vi.fn() }))
vi.mock('./ai', () => ({
  generateDigest: vi.fn(), generateDraft: vi.fn(), listAiModels: vi.fn(), resolveAiKey: vi.fn(),
  testAiConnection: vi.fn(), validateAiSettings: vi.fn(),
  assertAiFeature: vi.fn((ai: { features?: Record<string, boolean> }, feature: string) => {
    if (ai.features?.[feature] === false) throw new Error('已在隐私设置中关闭该功能的 AI 处理')
  }),
  aiHost: vi.fn(() => 'ai.example')
}))
vi.mock('./mail-overview', () => ({ getMailOverview: vi.fn() }))
vi.mock('./mail', () => ({
  executeAgentAction: vi.fn(), getMail: vi.fn(), getMailAttachment: vi.fn(), getSentFolder: vi.fn(), listMail: vi.fn(),
  listMailCached: vi.fn(), inspectAccountHealth: vi.fn(), listMailFolders: vi.fn(), sendMail: vi.fn(),
  testAccount: vi.fn(), todayMail: vi.fn()
}))

import { runAgentTask } from './agent'
import { generateDigest } from './ai'
import { getMail, getMailAttachment, inspectAccountHealth, listMailCached, testAccount, todayMail } from './mail'
import { BackendContext } from './service'

const account: StoredAccount = {
  id: 'account', provider: 'qq', address: 'student@qq.com', authorizationCode: 'secret'
}
const settings = {
  baseUrl: 'https://ai.example/v1', model: 'test', apiKey: 'key', dailyTime: '09:00', autoDaily: false
}
const jobIds = [
  '123e4567-e89b-42d3-a456-426614174000',
  '123e4567-e89b-42d3-a456-426614174001'
]

function contextWithHistory(history: AgentConversation[] = [], ai: AiSettingsInput = settings): {
  context: BackendContext
  state: { active: boolean; version: number; accounts: StoredAccount[]; history: AgentConversation[]
    digests: DigestHistoryItem[]; drafts: SavedDraft[]; activity: AiActivityEntry[] }
  setAccounts: ReturnType<typeof vi.fn>
  setHistory: ReturnType<typeof vi.fn>
  setDigests: ReturnType<typeof vi.fn>
  setActivity: ReturnType<typeof vi.fn>
} {
  const state = { active: true, version: 0, accounts: [account], history,
    digests: [] as DigestHistoryItem[], drafts: [] as SavedDraft[], activity: [] as AiActivityEntry[] }
  const setAccounts = vi.fn(async (items: StoredAccount[]) => { state.accounts = items })
  const setSavedDrafts = vi.fn(async (items: SavedDraft[]) => { state.drafts = items.slice(0, 20) })
  const setAccountsAndSavedDrafts = vi.fn(async (items: StoredAccount[], drafts: SavedDraft[]) => {
    await setAccounts(items)
    state.drafts = drafts.slice(0, 20)
  })
  const setHistory = vi.fn(async (items: AgentConversation[]) => { state.history = items })
  const setDigests = vi.fn(async (items: DigestHistoryItem[]) => { state.digests = items })
  const setActivity = vi.fn(async (items: AiActivityEntry[]) => { state.activity = items })
  const store = {
    ai, themeMode: 'system',
    refresh: vi.fn(async () => undefined),
    logout: vi.fn(() => { state.active = false; state.version++ }),
    setAccounts, setSavedDrafts, setAccountsAndSavedDrafts,
    setAgentConversations: setHistory, setDigestHistory: setDigests, setAiActivity: setActivity
  } as Record<string, unknown>
  Object.defineProperties(store, {
    activeUsername: { get: () => state.active ? 'dmc' : null },
    sessionVersion: { get: () => state.version },
    accounts: { get: () => state.accounts },
    savedDrafts: { get: () => state.drafts },
    agentConversations: { get: () => state.history },
    digestHistory: { get: () => state.digests },
    aiActivity: { get: () => state.activity }
  })
  return { context: new BackendContext(store as unknown as MysqlStore, 'token'), state, setAccounts, setHistory, setDigests, setActivity }
}

function blockedAgent(stage: Omit<AgentProgress, 'jobId'>['stage']): Promise<void> {
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  vi.mocked(runAgentTask).mockImplementationOnce(async (_settings, _prompt, _accounts, _history, progress, ensureActive, signal) => {
    progress({ stage, detail: `处于 ${stage} 阶段` })
    started()
    await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
    ensureActive?.()
    return { answer: '不应保存', sources: [], actions: [], warnings: [], truncated: false, scope: '测试' }
  })
  return ready
}

beforeEach(() => vi.resetAllMocks())

describe('BackendContext Agent concurrency', () => {
  it('keeps mail list and detail reads responsive while an Agent job is running', async () => {
    const { context } = contextWithHistory()
    const ready = blockedAgent('planning')
    vi.mocked(listMailCached).mockResolvedValue({ messages: [], truncated: false, warnings: [] })
    vi.mocked(getMail).mockResolvedValue({
      uid: 7, accountId: account.id, folder: 'INBOX', uidValidity: '1', from: 'teacher@example.com',
      subject: '课程', date: new Date().toISOString(), unread: false, to: '', text: '正文', html: '',
      inlineImages: [], attachments: []
    })
    const running = context.invoke('agent:run', ['总结邮件', '', jobIds[0]])
    await ready
    await expect(context.invoke('mail:list', [account.id, 'INBOX'])).resolves.toEqual({ messages: [], truncated: false, warnings: [] })
    await expect(context.invoke('mail:get', [account.id, 'INBOX', 7, false])).resolves.toMatchObject({ uid: 7 })
    await context.invoke('agent:cancel', [jobIds[0]])
    await expect(running).rejects.toThrow('Agent 任务已取消')
  })

  it.each(['planning', 'searching', 'answering'] as const)('cancels safely during %s without saving partial results', async (stage) => {
    const { context, setHistory } = contextWithHistory()
    const events: AgentProgress[] = []
    context.listeners.add((channel, payload) => { if (channel === 'agent:progress') events.push(payload as AgentProgress) })
    const ready = blockedAgent(stage)
    const running = context.invoke('agent:run', ['总结邮件', '', jobIds[0]])
    const rejected = expect(running).rejects.toThrow('Agent 任务已取消')
    await ready
    await expect(context.invoke('agent:cancel', [jobIds[0]])).resolves.toEqual({ jobId: jobIds[0], status: 'cancelling' })
    await rejected
    await expect(context.invoke('agent:cancel', [jobIds[0]])).resolves.toEqual({ jobId: jobIds[0], status: 'idle' })
    expect(setHistory).not.toHaveBeenCalled()
    expect(context.proposals.take.bind(context.proposals, 'missing', 0)).toThrow('失效')
    expect(events.at(-1)).toMatchObject({ jobId: jobIds[0], stage: 'cancelled', detail: '任务已取消' })
  })

  it('rejects a second Agent request immediately instead of queueing it', async () => {
    const { context } = contextWithHistory()
    const ready = blockedAgent('planning')
    const first = context.invoke('agent:run', ['第一项', '', jobIds[0]])
    await ready
    await expect(context.invoke('agent:run', ['第二项', '', jobIds[1]])).rejects.toThrow('正在处理上一项任务')
    await context.invoke('agent:cancel', [jobIds[0]])
    await expect(first).rejects.toThrow('Agent 任务已取消')
  })

  it('cancels the current job before clearing history', async () => {
    const old: AgentConversation = { id: 'old', updatedAt: new Date().toISOString(), messages: [
      { id: 'message', role: 'assistant', content: '旧结果', createdAt: new Date().toISOString() }
    ] }
    const { context, state, setHistory } = contextWithHistory([old])
    const ready = blockedAgent('searching')
    const running = context.invoke('agent:run', ['总结邮件', '', jobIds[0]])
    await ready
    await context.invoke('agent:clear', [])
    await expect(running).rejects.toThrow('Agent 任务已取消')
    expect(setHistory).toHaveBeenLastCalledWith([])
    expect(state.history).toEqual([])
  })

  it('aborts on logout and emits or persists nothing after invalidation', async () => {
    const { context, setHistory } = contextWithHistory()
    const events: AgentProgress[] = []
    context.listeners.add((channel, payload) => { if (channel === 'agent:progress') events.push(payload as AgentProgress) })
    const ready = blockedAgent('answering')
    const running = context.invoke('agent:run', ['总结邮件', '', jobIds[0]])
    await ready
    const countBeforeLogout = events.length
    context.invalidate(false)
    await expect(running).rejects.toThrow('Agent 任务已取消')
    expect(events).toHaveLength(countBeforeLogout)
    expect(setHistory).not.toHaveBeenCalled()
  })
})

describe('BackendContext digest history', () => {
  it('persists a successful digest and reuses the same automatic result for the local day', async () => {
    const { context, state, setDigests } = contextWithHistory()
    context.setTimeZone('Asia/Shanghai')
    vi.mocked(todayMail).mockResolvedValue({ messages: [], warnings: [] })
    vi.mocked(generateDigest).mockImplementation(async (_settings, date) => ({
      date, content: '今日摘要', sources: [], warnings: []
    }))
    const first = await context.invoke('ai:digest:auto', [[account.id]]) as DigestHistoryItem
    expect(first).toMatchObject({ mode: 'auto', content: '今日摘要' })
    expect(setDigests).toHaveBeenCalledTimes(1)
    expect(state.digests).toEqual([first])
    const second = await context.invoke('ai:digest:auto', [[account.id]])
    expect(second).toEqual(first)
    expect(generateDigest).toHaveBeenCalledTimes(1)
    expect(setDigests).toHaveBeenCalledTimes(1)
  })
})

describe('BackendContext account maintenance', () => {
  const health = {
    accountId: account.id,
    imap: { ok: true, message: '收件连接正常' },
    smtp: { ok: true, message: '发件连接正常' },
    checkedAt: '2026-11-12T04:00:00.000Z'
  }

  it('validates both connections before atomically replacing only the authorization code', async () => {
    const { context, state, setAccounts } = contextWithHistory()
    vi.mocked(testAccount).mockResolvedValue(health)
    await expect(context.invoke('accounts:update-authorization', [account.id, ' new-secret '])).resolves.toEqual(health)
    expect(testAccount).toHaveBeenCalledWith({ ...account, authorizationCode: 'new-secret' })
    expect(setAccounts).toHaveBeenCalledTimes(1)
    expect(state.accounts).toEqual([{ ...account, authorizationCode: 'new-secret' }])
  })

  it('keeps the old credential when validation fails', async () => {
    const { context, state, setAccounts } = contextWithHistory()
    vi.mocked(testAccount).mockRejectedValue(new Error('provider leaked detail'))
    await expect(context.invoke('accounts:update-authorization', [account.id, 'bad-secret']))
      .rejects.toThrow('旧授权码未被修改')
    expect(setAccounts).not.toHaveBeenCalled()
    expect(state.accounts[0].authorizationCode).toBe('secret')
  })

  it('does not restore an account deleted while credential validation is running', async () => {
    const { context, state, setAccounts } = contextWithHistory()
    let finish!: () => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(testAccount).mockImplementation(async () => {
      started()
      await new Promise<void>((resolve) => { finish = resolve })
      return health
    })
    const updating = context.invoke('accounts:update-authorization', [account.id, 'new-secret'])
    await ready
    await context.invoke('accounts:remove', [account.id])
    finish()
    await expect(updating).rejects.toThrow('邮箱账户不存在')
    expect(state.accounts).toEqual([])
    expect(setAccounts).toHaveBeenCalledTimes(1)
  })

  it('rejects a credential write after the session changes', async () => {
    const { context, setAccounts } = contextWithHistory()
    let finish!: () => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(testAccount).mockImplementation(async () => {
      started()
      await new Promise<void>((resolve) => { finish = resolve })
      return health
    })
    const updating = context.invoke('accounts:update-authorization', [account.id, 'new-secret'])
    await ready
    context.invalidate(false)
    finish()
    await expect(updating).rejects.toThrow('登录状态已变化')
    expect(setAccounts).not.toHaveBeenCalled()
  })

  it('reports IMAP and SMTP independently without exposing a credential', async () => {
    const { context } = contextWithHistory()
    vi.mocked(inspectAccountHealth).mockResolvedValue({ ...health,
      smtp: { ok: false, message: '发件连接失败' } })
    const result = await context.invoke('accounts:health', [account.id])
    expect(result).toMatchObject({ accountId: account.id, imap: { ok: true }, smtp: { ok: false } })
    expect(JSON.stringify(result)).not.toContain(account.authorizationCode)
  })
})

describe('BackendContext saved drafts', () => {
  it('stores only a bounded encrypted-vault draft list and removes a selected draft', async () => {
    const { context, state } = contextWithHistory()
    for (let index = 0; index < 21; index++) {
      await context.invoke('drafts:save', ['', {
        accountId: account.id, to: ['teacher@example.com'], cc: [], bcc: [],
        subject: `草稿 ${index}`, text: `正文 ${index}`
      }])
    }
    expect(state.drafts).toHaveLength(20)
    expect(state.drafts[0].draft.subject).toBe('草稿 20')
    expect(await context.invoke('drafts:list', [])).toEqual(state.drafts)
    const removed = state.drafts[0].id
    await context.invoke('drafts:remove', [removed])
    expect(state.drafts.some((item) => item.id === removed)).toBe(false)
  })

  it('refuses to save a draft for an account that no longer exists', async () => {
    const { context } = contextWithHistory()
    await expect(context.invoke('drafts:save', ['', {
      accountId: 'missing', to: [], cc: [], bcc: [], subject: '孤立草稿', text: ''
    }])).rejects.toThrow('邮箱账户不存在')
  })
})

describe('BackendContext attachment access', () => {
  it('binds attachment download to the current account and mailbox identity', async () => {
    const { context } = contextWithHistory()
    vi.mocked(getMailAttachment).mockResolvedValue({
      fileName: 'report.pdf', contentType: 'application/pdf', size: 3, base64: 'YWJj'
    })
    await expect(context.invoke('mail:attachment', [account.id, 'INBOX', 7, '55', 'attachment-1']))
      .resolves.toMatchObject({ fileName: 'report.pdf', size: 3 })
    expect(getMailAttachment).toHaveBeenCalledWith(account, 'INBOX', 7, '55', 'attachment-1')
    await expect(context.invoke('mail:attachment', ['missing', 'INBOX', 7, '55', 'attachment-1']))
      .rejects.toThrow('邮箱账户不存在')
  })
})

describe('AI privacy boundaries', () => {
  const detail = (uid: number, subject: string, text: string): MailDetail => ({
    uid, accountId: account.id, folder: 'INBOX', uidValidity: '1', from: 'teacher@example.com',
    subject, date: '2026-11-14T02:00:00.000Z', unread: false, to: 'student@qq.com', text,
    html: '', inlineImages: [], attachments: []
  })

  it('skips verification-code mail and records the outbound activity', async () => {
    const { context, state } = contextWithHistory()
    vi.mocked(todayMail).mockResolvedValue({ messages: [
      detail(1, '验证码 123456', '您的验证码是 123456，请勿告诉他人'),
      detail(2, '课程报告', '周五提交')
    ], warnings: [] })
    vi.mocked(generateDigest).mockResolvedValue({ date: '2026-11-14', content: '摘要', sources: [], warnings: [] })
    await context.invoke('ai:digest', [[account.id]])
    expect(vi.mocked(generateDigest).mock.calls[0][2].map((mail) => mail.subject)).toEqual(['课程报告'])
    expect(state.digests[0].warnings.join()).toContain('跳过 1 封')
    expect(state.activity[0]).toMatchObject({ feature: 'digest', mails: 1, ok: true, host: 'ai.example' })
  })

  it('refuses a feature the user turned off', async () => {
    const { context } = contextWithHistory([], { ...settings, features: { digest: false } } satisfies AiSettingsInput)
    await expect(context.invoke('ai:digest', [[account.id]])).rejects.toThrow('隐私设置')
    expect(generateDigest).not.toHaveBeenCalled()
  })
})
