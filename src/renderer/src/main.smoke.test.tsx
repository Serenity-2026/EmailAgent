// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, AgentConversation, AgentProposal, DesktopApi, MailSummary, SavedDraft } from '../../shared/models'

vi.setConfig({ testTimeout: 15_000 })

const account: Account = { id: 'account', provider: 'qq', address: 'student@qq.com' }
const mail: MailSummary = {
  uid: 7, accountId: account.id, folder: 'INBOX', from: 'teacher@example.com',
  subject: '课程安排', date: '2026-11-11T08:00:00.000Z', unread: true
}

function apiFor(session: string | null, bootstrapRequired = false, demoMode = false): DesktopApi {
  let username = session
  let savedDrafts: SavedDraft[] = []
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
    updateAccountAuthorizationCode: vi.fn(async (accountId) => ({ accountId,
      imap: { ok: true, message: '收件连接正常' }, smtp: { ok: true, message: '发件连接正常' },
      checkedAt: new Date().toISOString() })),
    checkAccountHealth: vi.fn(async (accountId) => ({ accountId,
      imap: { ok: true, message: '收件连接正常' }, smtp: { ok: true, message: '发件连接正常' },
      checkedAt: new Date().toISOString() })),
    listMailFolders: vi.fn(async () => [{ id: 'inbox', path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox', selectable: true, readOnly: false }]),
    listMail: vi.fn(async () => ({ messages: [mail], truncated: false, warnings: [] })),
    getMail: vi.fn(), openExternalLink: vi.fn(async () => undefined),
    saveAttachment: vi.fn(async (_accountId, _folder, _uid, _uidValidity, _attachmentId, suggestedName) =>
      ({ saved: true, fileName: suggestedName })),
    getSentFolder: vi.fn(async () => 'Sent'), sendMail: vi.fn(async () => undefined),
    listSavedDrafts: vi.fn(async () => savedDrafts),
    saveDraft: vi.fn(async (id, draft) => {
      const saved = { id: id || 'saved-draft', updatedAt: new Date().toISOString(), draft }
      savedDrafts = [saved, ...savedDrafts.filter((item) => item.id !== saved.id)]
      return saved
    }),
    removeSavedDraft: vi.fn(async (id) => { savedDrafts = savedDrafts.filter((item) => item.id !== id) }),
    setComposeDirty: vi.fn(async () => undefined),
    exportDiagnostics: vi.fn(async () => ({ saved: true, fileName: 'diagnostics.txt' })),
    getAiSettings: vi.fn(async () => ({ baseUrl: 'https://example.com/v1', model: 'model', dailyTime: '09:00', autoDaily: false, hasApiKey: true, activity: [] })),
    clearAiActivity: vi.fn(async () => undefined),
    isFullscreen: vi.fn(async () => false),
    onFullscreenChange: vi.fn(() => () => undefined),
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
    const recipient = document.querySelector('.ant-modal input[placeholder="name@example.com"]') as HTMLInputElement | null
    const subject = document.querySelector('.ant-modal input[placeholder="邮件主题"]') as HTMLInputElement | null
    const body = document.querySelector('.ant-modal textarea') as HTMLTextAreaElement | null
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(recipient, 'one@example.com'); recipient?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(subject, '主题'); subject?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
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

  it('shows separate account health and updates a credential without echoing the saved value', async () => {
    const api = apiFor('dmc')
    api.checkAccountHealth = vi.fn(async (accountId) => ({ accountId,
      imap: { ok: true, message: '收件连接正常' }, smtp: { ok: false, message: '发件连接失败' },
      checkedAt: '2026-11-12T04:00:00.000Z' }))
    window.emailAgent = api
    const { EmailApp } = await import('./app/email-app')
    const appRoot = createRoot(container)
    root = appRoot
    await act(async () => appRoot.render(<EmailApp themeMode="system" setThemeMode={() => undefined} dark={false} />))
    await flush(); await flush()

    await act(async () => (container.querySelector('.account-trigger') as HTMLButtonElement | null)?.click())
    await flush()
    expect(document.body.textContent).toContain('IMAP：收件连接正常')
    expect(document.body.textContent).toContain('SMTP：发件连接失败')
    expect(document.body.textContent).toContain('邮箱地址和服务商不可修改')

    await act(async () => buttonNamed(document, '更新授权码')?.click())
    const password = document.querySelector('.ant-modal input[type="password"]') as HTMLInputElement | null
    expect(password?.value).toBe('')
    expect(password?.placeholder).toContain('不会显示或回填旧授权码')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(password, 'replacement-code'); password?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => buttonNamed(document, '验证并更新')?.click())
    await flush()
    expect(api.updateAccountAuthorizationCode).toHaveBeenCalledWith(account.id, 'replacement-code')
    await act(async () => buttonNamed(document, '导出诊断信息')?.click())
    await flush()
    expect(api.exportDiagnostics).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('诊断信息已导出')
  })

  it('saves a local draft, warns about later edits and removes the saved draft after sending', async () => {
    const api = apiFor('dmc')
    window.emailAgent = api
    const { EmailApp } = await import('./app/email-app')
    const appRoot = createRoot(container)
    root = appRoot
    await act(async () => appRoot.render(<EmailApp themeMode="system" setThemeMode={() => undefined} dark={false} />))
    await flush(); await flush()
    await act(async () => buttonNamed(container, '写邮件')?.click())

    const recipient = document.querySelector('.ant-modal input[placeholder="name@example.com"]') as HTMLInputElement
    const cc = document.querySelector('.ant-modal input[placeholder="cc@example.com"]') as HTMLInputElement
    const bcc = document.querySelector('.ant-modal input[placeholder="bcc@example.com"]') as HTMLInputElement
    const subject = document.querySelector('.ant-modal input[placeholder="邮件主题"]') as HTMLInputElement
    const body = document.querySelector('.ant-modal textarea') as HTMLTextAreaElement
    const setInput = async (field: HTMLInputElement, value: string): Promise<void> => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await setInput(recipient, 'teacher@example.com, reviewer@example.com')
    await setInput(cc, 'assistant@example.com')
    await setInput(bcc, 'hidden@example.com')
    await setInput(subject, '课程草稿')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(body, '尚未发送的正文')
      body.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    expect(vi.mocked(api.setComposeDirty).mock.calls.some(([dirty]) => dirty)).toBe(true)

    await act(async () => buttonNamed(document, '保存草稿')?.click())
    await flush()
    expect(api.saveDraft).toHaveBeenCalledWith('', expect.objectContaining({
      to: ['teacher@example.com', 'reviewer@example.com'], cc: ['assistant@example.com'], bcc: ['hidden@example.com'],
      subject: '课程草稿', text: '尚未发送的正文'
    }))
    expect(vi.mocked(api.setComposeDirty).mock.calls.at(-1)?.[0]).toBe(false)

    await setInput(subject, '课程草稿（修改）')
    await act(async () => buttonNamed(document, '取消')?.click())
    await flush()
    expect(document.body.textContent).toContain('放弃未保存的修改？')
    await act(async () => buttonNamed(document, '继续编辑')?.click())

    await act(async () => buttonNamed(document, '预览')?.click())
    await act(async () => buttonNamed(document, '确认发送')?.click())
    await flush()
    expect(api.sendMail).toHaveBeenCalled()
    expect(api.removeSavedDraft).toHaveBeenCalledWith('saved-draft')
  })

  it('downloads an allowed attachment on demand and disables an oversized one', async () => {
    const api = apiFor('dmc')
    api.getMail = vi.fn(async () => ({ ...mail, uidValidity: '55', to: account.address, text: '正文',
      inlineImages: [], attachments: [
        { id: 'attachment-1', name: 'report.pdf', contentType: 'application/pdf', size: 2048, downloadable: true },
        { id: 'attachment-2', name: 'large.zip', contentType: 'application/zip', size: 11_000_000,
          downloadable: false, reason: '单个附件超过 10 MB' }
      ] }))
    window.emailAgent = api
    const { EmailApp } = await import('./app/email-app')
    const appRoot = createRoot(container)
    root = appRoot
    await act(async () => appRoot.render(<EmailApp themeMode="system" setThemeMode={() => undefined} dark={false} />))
    await flush(); await flush()
    const row = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('课程安排'))
    await act(async () => row?.click())
    await flush()
    const report = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('report.pdf')) as HTMLButtonElement
    const large = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('large.zip')) as HTMLButtonElement
    expect(large.disabled).toBe(true)
    expect(large.title).toContain('10 MB')
    await act(async () => report.click())
    await flush()
    expect(api.saveAttachment).toHaveBeenCalledWith(account.id, 'INBOX', 7, '55', 'attachment-1', 'report.pdf')
    expect(container.textContent).toContain('已保存附件：report.pdf')
  })

  it('navigates real folders, loads older mail, remembers account search state and falls back safely', async () => {
    const second: Account = { id: 'second', provider: '163', address: 'student@163.com' }
    const api = apiFor('dmc')
    let draftsAvailable = true
    api.listAccounts = vi.fn(async () => [account, second])
    api.listMailFolders = vi.fn(async (accountId) => [
      { id: `${accountId}-inbox`, path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox', selectable: true, readOnly: false },
      ...(accountId === account.id && draftsAvailable
        ? [{ id: 'drafts', path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts', selectable: true, readOnly: false }] : [])
    ])
    api.listMail = vi.fn(async (accountId, target, options) => ({
      messages: [{ ...mail, accountId, folder: target }],
      ...(options?.cursor ? {} : { nextCursor: 'next-page' }), truncated: false, warnings: []
    }))
    window.emailAgent = api
    const { EmailApp } = await import('./app/email-app')
    const appRoot = createRoot(container)
    root = appRoot
    await act(async () => appRoot.render(<EmailApp themeMode="system" setThemeMode={() => undefined} dark={false} />))
    await flush(); await flush()

    await act(async () => buttonNamed(container, '继续加载')?.click())
    await flush()
    expect(vi.mocked(api.listMail).mock.calls.some((call) => call[2]?.cursor === 'next-page')).toBe(true)

    await act(async () => buttonNamed(container, '草稿箱')?.click())
    await flush()
    const subject = container.querySelector('.mail-search input[placeholder="主题"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(subject, '课程报告'); subject.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => buttonNamed(container, '搜索')?.click())
    await flush()
    expect(vi.mocked(api.listMail).mock.calls.some((call) => call[1] === 'Drafts' && call[2]?.query?.subject === '课程报告')).toBe(true)

    await act(async () => buttonNamed(container, second.address)?.click())
    await flush(); await flush()
    await act(async () => buttonNamed(container, account.address)?.click())
    await flush(); await flush()
    expect(vi.mocked(api.listMail).mock.calls.at(-1)?.[1]).toBe('Drafts')
    expect((container.querySelector('.mail-search input[placeholder="主题"]') as HTMLInputElement).value).toBe('课程报告')

    await act(async () => buttonNamed(container, second.address)?.click())
    await flush(); draftsAvailable = false
    await act(async () => buttonNamed(container, account.address)?.click())
    await flush(); await flush()
    expect(vi.mocked(api.listMail).mock.calls.at(-1)?.[1]).toBe('INBOX')
  })
})
