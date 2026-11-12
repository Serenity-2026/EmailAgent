// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, AgentConversation, AgentProposal, DesktopApi, MailSummary } from '../../shared/models'

vi.setConfig({ testTimeout: 15_000 })

const account: Account = { id: 'account', provider: 'qq', address: 'student@qq.com' }
const mail: MailSummary = {
  uid: 7, accountId: account.id, folder: 'INBOX', from: 'teacher@example.com',
  subject: '课程安排', date: '2026-11-11T08:00:00.000Z', unread: true
}

function apiFor(session: string | null, bootstrapRequired = false, demoMode = false): DesktopApi {
  let username = session
  const conversation: AgentConversation = { id: 'conversation', updatedAt: new Date().toISOString(), messages: [
    { id: 'assistant', role: 'assistant', content: '已找到邮件 [1]', createdAt: new Date().toISOString(), sources: [
      { ...mail, accountAddress: account.address, uidValidity: '1', citationNumber: 1, archiveAvailable: true }
    ] }
  ] }
  const proposal: AgentProposal = { id: 'proposal', expiresAt: new Date(Date.now() + 60_000).toISOString(), actions: [
    { kind: 'markRead', mail: { ...mail, accountAddress: account.address, uidValidity: '1', archiveAvailable: true } }
  ] }
  return {
    getBootstrapStatus: vi.fn(async () => ({ required: bootstrapRequired, demoMode })),
    bootstrap: vi.fn(async () => { username = 'admin'; bootstrapRequired = false; return { username } }),
    getSession: vi.fn(async () => ({ username })),
    login: vi.fn(async () => { username = 'dmc'; return { username } }), logout: vi.fn(async () => undefined),
    createUser: vi.fn(async () => undefined), changePassword: vi.fn(async () => undefined),
    listAccounts: vi.fn(async () => [account]), addAccount: vi.fn(), removeAccount: vi.fn(async () => undefined),
    listMail: vi.fn(async () => [mail]), getMail: vi.fn(), openExternalLink: vi.fn(async () => undefined),
    getSentFolder: vi.fn(async () => 'Sent'), sendMail: vi.fn(async () => undefined),
    getAiSettings: vi.fn(async () => ({ baseUrl: 'https://example.com/v1', model: 'model', dailyTime: '09:00', autoDaily: false, hasApiKey: true })),
    listAiModels: vi.fn(async () => ['model']), saveAiSettings: vi.fn(async () => undefined),
    testAiConnection: vi.fn(async () => undefined), generateDraft: vi.fn(), generateDigest: vi.fn(),
    listDigestHistory: vi.fn(async () => []), onDailyDigest: vi.fn(() => () => undefined),
    onDailyDigestFailure: vi.fn(() => () => undefined), listAgentConversations: vi.fn(async () => []),
    runAgent: vi.fn(async () => ({ conversation, proposal, scope: '近期', truncated: false, warnings: [] })),
    cancelAgentJob: vi.fn(async (jobId) => ({ jobId, status: 'cancelling' as const })),
    confirmAgentProposal: vi.fn(), clearAgentHistory: vi.fn(async () => undefined),
    onAgentProgress: vi.fn(() => () => undefined), onAppError: vi.fn(() => () => undefined),
    getAgentOverview: vi.fn(async () => ({ since: new Date().toISOString(), received: 1, sent: 0, sampled: false,
      topSenders: [], topRecipients: [], topics: [], warnings: [] })),
    getThemeMode: vi.fn(async () => 'system' as const), setThemeMode: vi.fn(async () => undefined)
  }
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

function buttonNamed(parent: ParentNode, label: string): HTMLButtonElement | undefined {
  return Array.from(parent.querySelectorAll('button')).find((button) => button.textContent?.replace(/\s/g, '') === label)
}

describe('renderer critical paths', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    })) })
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    root = null
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows the login path for an unauthenticated session', async () => {
    window.emailAgent = apiFor(null, false, true)
    const { EmailApp } = await import('./app/email-app')
    const appRoot = createRoot(container)
    root = appRoot
    await act(async () => appRoot.render(<EmailApp themeMode="system" setThemeMode={() => undefined} dark={false} />))
    await flush()
    expect(container.textContent).toContain('登录')
    expect(container.textContent).toContain('当前为演示模式')
    expect(container.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('shows first-run administrator creation instead of a fixed default account', async () => {
    window.emailAgent = apiFor(null, true)
    const { EmailApp } = await import('./app/email-app')
    const appRoot = createRoot(container)
    root = appRoot
    await act(async () => appRoot.render(<EmailApp themeMode="system" setThemeMode={() => undefined} dark={false} />))
    await flush()
    expect(container.textContent).toContain('创建首位管理员')
    expect(container.textContent).not.toContain('当前为演示模式')
  })

  it('reaches the mailbox, compose preview and Agent confirmation paths', async () => {
    window.emailAgent = apiFor('dmc')
    const { EmailApp } = await import('./app/email-app')
    const appRoot = createRoot(container)
    root = appRoot
    await act(async () => appRoot.render(<EmailApp themeMode="system" setThemeMode={() => undefined} dark={false} />))
    await flush()
    expect(container.textContent).toContain('课程安排')

    const write = buttonNamed(container, '写邮件')
    await act(async () => write?.click())
    const fields = Array.from(document.querySelectorAll('.ant-modal input')) as HTMLInputElement[]
    const body = document.querySelector('.ant-modal textarea') as HTMLTextAreaElement | null
    await act(async () => {
      for (const [field, value] of fields.map((field, index) => [field, index === 0 ? 'one@example.com' : '主题'] as const)) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(body, '正文'); body?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const preview = buttonNamed(document, '预览')
    await act(async () => preview?.click())
    expect(document.body.textContent).toContain('确认发送')

    const cancel = buttonNamed(document, '取消')
    await act(async () => cancel?.click())
    const agent = buttonNamed(container, '对话')
    await act(async () => agent?.click())
    await flush()
    const prompt = container.querySelector('.agent-compose textarea') as HTMLTextAreaElement | null
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(prompt, '把邮件标记为已读'); prompt?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const run = buttonNamed(container, '执行任务')
    await act(async () => run?.click())
    await flush()
    expect(container.textContent).toContain('确认整理')
  })
})
