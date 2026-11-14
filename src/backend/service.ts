import { randomUUID } from 'node:crypto'
import type {
  AccountHealth, AccountInput, AgentCancelResult, AgentConfirmResult, AgentConversation, AgentMessage, AgentProgress,
  AiActivityEntry, AiSettingsInput, DigestHistoryItem, MailDraft, MailListOptions, ThemeMode
} from '../shared/models'
import { normalizeMailDraft, type StoredAccount } from '../shared/vault'
import {
  aiHost, assertAiFeature, generateDigest as summarize, generateDraft, listAiModels, resolveAiKey, testAiConnection,
  validateAiSettings
} from './ai'
import { runAgentTask } from './agent'
import { AgentProposalRegistry, executeConfirmedActions } from './agent-proposals'
import { getMailOverview } from './mail-overview'
import { splitSensitiveMails } from './privacy'
import {
  executeAgentAction, getMail, getMailAttachment, getSentFolder, inspectAccountHealth, listMailCached, listMailFolders,
  sendMail, testAccount, todayMail
} from './mail'
import { mailListCache } from './mail-cache'
import { overviewCache } from './overview-cache'
import { validateAccount } from './providers'
import { MysqlStore } from './store'
import { DailyDigestCoordinator } from './digest-scheduler'
import { isIanaTimeZone, startOfZonedDay, zonedClock } from './timezone'

interface AgentJob {
  id: string
  version: number
  controller: AbortController
}

const SERIALIZED_CHANNELS = new Set([
  'auth:create', 'auth:password', 'accounts:remove', 'drafts:save', 'drafts:remove', 'theme:set'
])

export class BackendContext {
  readonly proposals = new AgentProposalRegistry()
  readonly dailyDigest = new DailyDigestCoordinator()
  readonly listeners = new Set<(channel: string, payload: unknown) => void>()
  timeZone = 'UTC'
  lastAccess = Date.now()
  private stateTail: Promise<unknown> = Promise.resolve()
  private agentJob: AgentJob | null = null
  private active = true
  constructor(readonly store: MysqlStore, readonly token: string) {}
  emit(channel: string, payload: unknown): void {
    if (!this.active) return
    for (const listener of this.listeners) listener(channel, payload)
  }
  invalidate(notify = true): void {
    this.agentJob?.controller.abort()
    this.proposals.clear()
    mailListCache.clearScope(this.store.username)
    overviewCache.clear(this.store.username)
    if (notify) this.emit('auth:expired', null)
    this.active = false
    this.store.logout()
    this.listeners.clear()
  }
  async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.stateTail.then(async () => {
      await this.store.refresh()
      return operation()
    })
    this.stateTail = result.catch(() => undefined)
    return result
  }
  beginAgentJob(id: string, version: number): AgentJob {
    if (this.agentJob) throw new Error('Agent 正在处理上一项任务，请先取消或等待完成')
    const job = { id, version, controller: new AbortController() }
    this.agentJob = job
    return job
  }
  ensureAgentJob(job: AgentJob): void {
    if (!this.active || this.agentJob !== job || job.controller.signal.aborted ||
      this.store.sessionVersion !== job.version || !this.store.activeUsername) {
      throw new Error(job.controller.signal.aborted ? 'Agent 任务已取消' : '登录状态已变化，请重试')
    }
  }
  finishAgentJob(job: AgentJob, stage: 'completed' | 'cancelled' | 'failed', detail: string): void {
    if (this.agentJob !== job) return
    this.agentJob = null
    this.emit('agent:progress', { jobId: job.id, stage, detail } satisfies AgentProgress)
  }
  cancelAgentJob(jobId: string): AgentCancelResult {
    if (!this.agentJob || this.agentJob.id !== jobId) return { jobId, status: 'idle' }
    this.agentJob.controller.abort()
    return { jobId, status: 'cancelling' }
  }
  cancelCurrentAgent(): void { this.agentJob?.controller.abort() }
  setTimeZone(value: string | undefined): void {
    if (value && isIanaTimeZone(value)) this.timeZone = value
  }
  async invoke(channel: string, args: unknown[]): Promise<unknown> {
    this.lastAccess = Date.now()
    if (channel === 'agent:cancel') return this.cancelAgentJob(args[0] as string)
    if (channel === 'agent:clear') this.cancelCurrentAgent()
    if (channel === 'agent:run' && this.agentJob) throw new Error('Agent 正在处理上一项任务，请先取消或等待完成')
    if (SERIALIZED_CHANNELS.has(channel)) return this.mutate(() => handleRpc(this, channel, args))
    await this.store.refresh()
    return handleRpc(this, channel, args)
  }
}

async function handleRpc(context: BackendContext, channel: string, args: unknown[]): Promise<unknown> {
  const store = context.store
  const agentProposals = context.proposals
  const handlers = new Map<string, (...args: any[]) => unknown>()
  function accountById(id: string): StoredAccount {
    const account = store.accounts.find((item) => item.id === id)
    if (!account) throw new Error('邮箱账户不存在')
    return account
  }

  function requireSession(version: number): void {
    if (store.sessionVersion !== version || !store.activeUsername) throw new Error('登录状态已变化，请重试')
  }

  async function recordAiActivity(feature: AiActivityEntry['feature'], settings: AiSettingsInput,
    info: { mails: number; characters: number; skipped?: number; ok: boolean }): Promise<void> {
    if (!settings.baseUrl) return
    const entry: AiActivityEntry = {
      at: new Date().toISOString(), feature, host: aiHost(settings.baseUrl),
      mails: info.mails, characters: info.characters, ok: info.ok,
      ...(info.skipped ? { skipped: info.skipped } : {})
    }
    try { await store.setAiActivity([entry, ...store.aiActivity]) } catch { /* 记录失败不影响主流程 */ }
  }

  async function digestFor(accountIds: string[], mode: 'manual' | 'auto'): Promise<DigestHistoryItem> {
    const version = store.sessionVersion
    const settings = store.ai
    assertAiFeature(settings, 'digest')
    const now = new Date()
    const date = zonedClock(now, context.timeZone).date
    if (mode === 'auto') {
      const existing = store.digestHistory.find((item) => item.mode === 'auto' && item.date === date)
      if (existing) return existing
    }
    const selected = accountIds.map(accountById)
    if (selected.length === 0) throw new Error('请先添加邮箱账户')
    const results = await Promise.allSettled(selected.map((account) => todayMail(account, startOfZonedDay(now, context.timeZone))))
    const warnings: string[] = []
    const mail = results.flatMap((result, index) => {
      if (result.status === 'rejected') {
        warnings.push(`${selected[index].address} 的今日邮件读取失败`)
        return []
      }
      warnings.push(...result.value.warnings)
      return result.value.messages
    }).sort((a, b) => a.date.localeCompare(b.date))
    if (results.every((result) => result.status === 'rejected')) throw new Error('所有邮箱的今日邮件读取失败，请检查连接')
    requireSession(version)
    const { kept, skipped } = splitSensitiveMails(mail)
    if (skipped) warnings.push(`已按隐私设置跳过 ${skipped} 封疑似含验证码或账户信息的邮件`)
    let digest
    try {
      digest = await summarize(settings, date, kept)
    } catch (error) {
      await recordAiActivity('digest', settings, { mails: kept.length, characters: 0, skipped, ok: false })
      throw error
    }
    requireSession(version)
    await recordAiActivity('digest', settings, {
      mails: kept.length, characters: kept.reduce((sum, item) => sum + item.text.length, 0), skipped, ok: true
    })
    const record: DigestHistoryItem = { ...digest, warnings, generatedAt: new Date().toISOString(), mode }
    await context.mutate(async () => {
      requireSession(version)
      const key = `${date}\0${mode}`
      await store.setDigestHistory([record, ...store.digestHistory.filter((item) => `${item.date}\0${item.mode}` !== key)])
      requireSession(version)
    })
    return record
  }

  handlers.set('auth:create', (username: string, password: string) => store.addUser(username, password))
  handlers.set('auth:password', (current: string, next: string) => store.changePassword(current, next, context.token))
  handlers.set('accounts:list', () => store.accounts.map(({ authorizationCode: _code, ...account }) => account))
  handlers.set('accounts:add', async (input: AccountInput) => {
    const version = store.sessionVersion
    validateAccount(input)
    if (store.accounts.some((account) => account.address.toLowerCase() === input.address.trim().toLowerCase())) {
      throw new Error('这个邮箱已经添加')
    }
    const account: StoredAccount = {
      id: randomUUID(),
      provider: input.provider,
      address: input.address.trim().toLowerCase(),
      authorizationCode: input.authorizationCode.trim()
    }
    try {
      await testAccount(account)
    } catch {
      throw new Error('连接失败，请检查 IMAP/SMTP 是否开启及授权码是否正确')
    }
    requireSession(version)
    await context.mutate(async () => {
      requireSession(version)
      if (store.accounts.some((item) => item.address.toLowerCase() === account.address)) throw new Error('这个邮箱已经添加')
      await store.setAccounts([...store.accounts, account])
      requireSession(version)
    })
    const { authorizationCode: _code, ...view } = account
    return view
  })
  handlers.set('accounts:remove', async (id: string) => {
    accountById(id)
    await store.setAccountsAndSavedDrafts(
      store.accounts.filter((account) => account.id !== id),
      store.savedDrafts.filter((item) => item.draft.accountId !== id)
    )
    mailListCache.clearAccount(store.username, id)
  })
  handlers.set('accounts:update-authorization', async (id: string, authorizationCode: string) => {
    const version = store.sessionVersion
    const current = accountById(id)
    const code = authorizationCode.trim()
    if (!code) throw new Error('请输入新的邮箱客户端授权码')
    const candidate: StoredAccount = { ...current, authorizationCode: code }
    let health: AccountHealth
    try {
      health = await testAccount(candidate)
    } catch {
      throw new Error('连接失败，旧授权码未被修改')
    }
    requireSession(version)
    await context.mutate(async () => {
      requireSession(version)
      const latest = accountById(id)
      if (latest.provider !== current.provider || latest.address !== current.address) {
        throw new Error('邮箱账户已变化，请重试')
      }
      await store.setAccounts(store.accounts.map((account) => account.id === id ? candidate : account))
      requireSession(version)
    })
    return health
  })
  handlers.set('accounts:health', async (id: string) => {
    const version = store.sessionVersion
    const account = { ...accountById(id) }
    const health = await inspectAccountHealth(account)
    requireSession(version)
    return context.mutate(async () => {
      requireSession(version)
      accountById(id)
      return health
    })
  })
  handlers.set('mail:folders', async (accountId: string) => {
    const version = store.sessionVersion
    const result = await listMailFolders(accountById(accountId))
    requireSession(version)
    return result
  })
  handlers.set('mail:list', async (accountId: string, folder: string, options?: MailListOptions) => {
    const version = store.sessionVersion
    const result = await listMailCached(store.username, accountById(accountId), folder, options)
    requireSession(version)
    return result
  })
  handlers.set('mail:get', async (accountId: string, folder: string, uid: number, markRead = true) => {
    if (typeof markRead !== 'boolean') throw new Error('阅读选项无效')
    const version = store.sessionVersion
    const result = await getMail(accountById(accountId), folder, uid, markRead)
    requireSession(version)
    if (markRead) mailListCache.markSeen(store.username, accountId, folder, uid)
    return result
  })
  handlers.set('mail:attachment', async (accountId: string, folder: string, uid: number,
    uidValidity: string, attachmentId: string) => {
    const version = store.sessionVersion
    const result = await getMailAttachment(accountById(accountId), folder, uid, uidValidity, attachmentId)
    requireSession(version)
    return result
  })
  handlers.set('mail:sent-folder', async (accountId: string) => {
    const version = store.sessionVersion
    const result = await getSentFolder(accountById(accountId))
    requireSession(version)
    return result
  })
  handlers.set('mail:send', async (draft: MailDraft) => {
    await sendMail(accountById(draft.accountId), draft)
    mailListCache.clearAccount(store.username, draft.accountId)
    overviewCache.clear(store.username)
  })
  handlers.set('drafts:list', () => store.savedDrafts)
  handlers.set('drafts:save', async (id: string, draft: MailDraft) => {
    const normalized = normalizeMailDraft(draft)
    if (!normalized) throw new Error('草稿格式无效')
    accountById(normalized.accountId)
    const record = {
      id: id.trim() || randomUUID(),
      updatedAt: new Date().toISOString(),
      draft: normalized
    }
    await store.setSavedDrafts([record, ...store.savedDrafts.filter((item) => item.id !== record.id)])
    return record
  })
  handlers.set('drafts:remove', async (id: string) => {
    await store.setSavedDrafts(store.savedDrafts.filter((item) => item.id !== id))
  })
  handlers.set('ai:settings:get', () => {
    const { apiKey: _key, ...view } = store.ai
    return { ...view, hasApiKey: Boolean(store.ai.apiKey), activity: store.aiActivity }
  })
  handlers.set('ai:activity:clear', async () => { await store.setAiActivity([]) })
  handlers.set('ai:models', (baseUrl: string, apiKey: string) =>
    listAiModels(baseUrl.trim(), resolveAiKey(baseUrl, apiKey, store.ai)))
  handlers.set('ai:settings:save', async (input: AiSettingsInput) => {
    const version = store.sessionVersion
    const settings = {
      ...input,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
      model: input.model.trim(),
      apiKey: resolveAiKey(input.baseUrl, input.apiKey, store.ai)
    }
    validateAiSettings(settings)
    await testAiConnection(settings)
    requireSession(version)
    await context.mutate(async () => {
      requireSession(version)
      await store.setAi(settings)
      requireSession(version)
    })
  })
  handlers.set('ai:settings:test', () => testAiConnection(store.ai))
  handlers.set('ai:draft', async (instruction: string, accountId: string) => {
    const version = store.sessionVersion
    accountById(accountId)
    assertAiFeature(store.ai, 'draft')
    let draft
    try {
      draft = await generateDraft(store.ai, instruction, accountId)
    } catch (error) {
      await recordAiActivity('draft', store.ai, { mails: 0, characters: instruction.length, ok: false })
      throw error
    }
    requireSession(version)
    await recordAiActivity('draft', store.ai, { mails: 0, characters: instruction.length, ok: true })
    return draft
  })
  handlers.set('ai:digest', (accountIds: string[]) => digestFor(accountIds, 'manual'))
  handlers.set('ai:digest:auto', (accountIds: string[]) => digestFor(accountIds, 'auto'))
  handlers.set('ai:digest:history', () => store.digestHistory)
  handlers.set('agent:history', () => store.agentConversations)
  handlers.set('agent:overview', async (options?: { force?: boolean }) => {
    const version = store.sessionVersion
    const accounts = [...store.accounts]
    if (!options?.force) {
      const cached = overviewCache.get(store.username, accounts)
      if (cached) return cached
    }
    const overview = await getMailOverview(accounts, store.ai, () => requireSession(version),
      (info) => { void recordAiActivity('topics', store.ai, info) })
    requireSession(version)
    overviewCache.set(store.username, accounts, overview)
    return overview
  })
  handlers.set('theme:get', () => store.themeMode)
  handlers.set('theme:set', async (mode: ThemeMode) => {
    const version = store.sessionVersion
    await store.setThemeMode(mode)
    requireSession(version)
  })
  handlers.set('agent:run', async (prompt: string, conversationId: string, jobId: string) => {
    const version = store.sessionVersion
    const accounts = [...store.accounts]
    const existing = conversationId ? store.agentConversations.find((item) => item.id === conversationId) : undefined
    if (conversationId && !existing) throw new Error('对话不存在或已过期')
    assertAiFeature(store.ai, 'agent')
    const job = context.beginAgentJob(jobId, version)
    try {
      const result = await runAgentTask(store.ai, prompt, accounts, existing, (progress) => {
        context.ensureAgentJob(job)
        context.emit('agent:progress', { ...progress, jobId })
      }, () => context.ensureAgentJob(job), job.controller.signal)
      context.ensureAgentJob(job)
      const createdAt = new Date().toISOString()
      const id = existing?.id || randomUUID()
      const messages: AgentMessage[] = [
        ...(existing?.messages || []),
        { id: randomUUID(), role: 'user', content: prompt.trim(), createdAt },
        { id: randomUUID(), role: 'assistant', content: result.answer, createdAt,
          sources: result.sources, draft: result.draft, scope: result.scope,
          truncated: result.truncated, warnings: result.warnings }
      ]
      const conversation: AgentConversation = { id, updatedAt: createdAt, messages }
      await context.mutate(async () => {
        context.ensureAgentJob(job)
        await store.setAgentConversations([conversation, ...store.agentConversations.filter((item) => item.id !== id)])
        context.ensureAgentJob(job)
      })
      context.ensureAgentJob(job)
      const proposal = result.actions.length ? agentProposals.create(version, id, result.actions) : undefined
      await recordAiActivity('agent', store.ai, { mails: result.sources.length, characters: 0, ok: true })
      context.finishAgentJob(job, 'completed', '任务已完成')
      return { conversation, scope: result.scope, truncated: result.truncated, warnings: result.warnings, proposal }
    } catch (error) {
      const cancelled = job.controller.signal.aborted
      if (!cancelled) await recordAiActivity('agent', store.ai, { mails: 0, characters: 0, ok: false })
      context.finishAgentJob(job, cancelled ? 'cancelled' : 'failed', cancelled ? '任务已取消' : '任务执行失败')
      if (cancelled) throw new Error('Agent 任务已取消')
      throw error
    }
  })
  handlers.set('agent:cancel', (jobId: string) => context.cancelAgentJob(jobId))
  handlers.set('agent:confirm', async (proposalId: string): Promise<AgentConfirmResult> => {
    const version = store.sessionVersion
    const proposal = agentProposals.take(proposalId, version)
    requireSession(version)
    const results = await executeConfirmedActions(proposal.actions,
      (action) => executeAgentAction(accountById(action.mail.accountId), action),
      () => requireSession(version))
    for (const action of proposal.actions) mailListCache.clearAccount(store.username, action.mail.accountId)
    overviewCache.clear(store.username)
    const conversation = store.agentConversations.find((item) => item.id === proposal.conversationId)
    let historySaved = Boolean(conversation)
    if (conversation) {
      const success = results.filter((item) => item.success).length
      const message: AgentMessage = {
        id: randomUUID(), role: 'assistant', createdAt: new Date().toISOString(),
        content: `整理完成：成功 ${success} 项，失败 ${results.length - success} 项。`,
        sources: results.map((item) => item.mail), actionResults: results
      }
      try {
        await context.mutate(async () => store.setAgentConversations([{ ...conversation, updatedAt: message.createdAt,
          messages: [...conversation.messages, message] }, ...store.agentConversations.filter((item) => item.id !== conversation.id)]))
      } catch {
        historySaved = false
      }
    }
    return { results, historySaved }
  })
  handlers.set('agent:clear', async () => {
    context.cancelCurrentAgent()
    await context.mutate(async () => store.setAgentConversations([]))
    agentProposals.clear()
  })
  const handler = handlers.get(channel)
  if (!handler) throw new Error('接口不存在')
  return handler(...args)
}
