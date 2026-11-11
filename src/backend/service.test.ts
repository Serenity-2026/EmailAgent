import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversation, AgentProgress } from '../shared/models'
import type { StoredAccount } from '../shared/vault'
import type { MysqlStore } from './store'

vi.mock('./agent', () => ({ runAgentTask: vi.fn() }))
vi.mock('./ai', () => ({
  generateDigest: vi.fn(), generateDraft: vi.fn(), listAiModels: vi.fn(), resolveAiKey: vi.fn(),
  testAiConnection: vi.fn(), validateAiSettings: vi.fn()
}))
vi.mock('./mail-overview', () => ({ getMailOverview: vi.fn() }))
vi.mock('./mail', () => ({
  executeAgentAction: vi.fn(), getMail: vi.fn(), getSentFolder: vi.fn(), listMail: vi.fn(),
  sendMail: vi.fn(), testAccount: vi.fn(), todayMail: vi.fn()
}))

import { runAgentTask } from './agent'
import { getMail, listMail } from './mail'
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

function contextWithHistory(history: AgentConversation[] = []): {
  context: BackendContext
  state: { active: boolean; version: number; history: AgentConversation[] }
  setHistory: ReturnType<typeof vi.fn>
} {
  const state = { active: true, version: 0, history }
  const setHistory = vi.fn(async (items: AgentConversation[]) => { state.history = items })
  const store = {
    accounts: [account], ai: settings, themeMode: 'system',
    refresh: vi.fn(async () => undefined),
    logout: vi.fn(() => { state.active = false; state.version++ }),
    setAgentConversations: setHistory
  } as Record<string, unknown>
  Object.defineProperties(store, {
    activeUsername: { get: () => state.active ? 'dmc' : null },
    sessionVersion: { get: () => state.version },
    agentConversations: { get: () => state.history }
  })
  return { context: new BackendContext(store as unknown as MysqlStore, 'token'), state, setHistory }
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
    vi.mocked(listMail).mockResolvedValue([])
    vi.mocked(getMail).mockResolvedValue({
      uid: 7, accountId: account.id, folder: 'INBOX', uidValidity: '1', from: 'teacher@example.com',
      subject: '课程', date: new Date().toISOString(), unread: false, to: '', text: '正文', html: '',
      inlineImages: [], attachmentNames: []
    })
    const running = context.invoke('agent:run', ['总结邮件', '', jobIds[0]])
    await ready
    await expect(context.invoke('mail:list', [account.id, 'INBOX'])).resolves.toEqual([])
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
