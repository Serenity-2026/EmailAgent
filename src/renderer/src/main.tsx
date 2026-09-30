import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, Button, ConfigProvider, Empty, Input, Modal, Select, Spin, Switch, theme } from 'antd'
import 'antd/dist/reset.css'
import type {
  Account, AccountInput, AgentConversation, AgentMessage, AgentProposal, AiSettingsInput, DailyDigest, DesktopApi,
  MailDetail, MailDraft, MailOverview, MailSummary, Provider, ThemeMode
} from '../../shared/models'
import { MailHtmlView } from './mail-html'
import './styles.css'

declare global {
  interface Window { emailAgent: DesktopApi }
}

const emptyDraft = (accountId: string): MailDraft => ({ accountId, to: '', subject: '', text: '' })
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
const dateText = (date: string): string => new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(date))
const RadarChart = React.lazy(async () => ({ default: (await import('@ant-design/plots')).Radar }))

function EmailApp({ themeMode, setThemeMode, dark }: {
  themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void; dark: boolean
}): React.JSX.Element {
  const api = window.emailAgent
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [folder, setFolder] = useState('INBOX')
  const [view, setView] = useState<'mail' | 'digest' | 'agent'>('mail')
  const [mails, setMails] = useState<MailSummary[]>([])
  const [selected, setSelected] = useState<MailSummary | null>(null)
  const [detail, setDetail] = useState<MailDetail | null>(null)
  const [mailLoading, setMailLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [digest, setDigest] = useState<DailyDigest | null>(null)
  const [digestLoading, setDigestLoading] = useState(false)
  const [agentConversations, setAgentConversations] = useState<AgentConversation[]>([])
  const [agentConversationId, setAgentConversationId] = useState('')
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentStatus, setAgentStatus] = useState('')
  const [agentProposal, setAgentProposal] = useState<AgentProposal | null>(null)
  const [overview, setOverview] = useState<MailOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const [activeUser, setActiveUser] = useState<string | null>(null)
  const [loginName, setLoginName] = useState('dmc')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [newUserName, setNewUserName] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [userBusy, setUserBusy] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmNextPassword, setConfirmNextPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [storageStatus, setStorageStatus] = useState<'loading' | 'ready' | 'unreadable' | 'failed'>('loading')
  const [storageBackup, setStorageBackup] = useState('')
  const [storageBusy, setStorageBusy] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountForm, setAccountForm] = useState<AccountInput>({ provider: 'qq', address: '', authorizationCode: '' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settings, setSettings] = useState<AiSettingsInput>({ baseUrl: '', model: '', apiKey: '', dailyTime: '09:00', autoDaily: false })
  const [hasAiKey, setHasAiKey] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [settingsNotice, setSettingsNotice] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [promptBusy, setPromptBusy] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composePreview, setComposePreview] = useState(false)
  const [composeBusy, setComposeBusy] = useState(false)
  const [draft, setDraft] = useState<MailDraft>(emptyDraft(''))
  const pendingSource = useRef<{ mail: MailSummary; markRead: boolean } | null>(null)
  const agentMessagesRef = useRef<HTMLDivElement>(null)
  const agentScrollState = useRef({ view: '', conversationId: '' })
  const overviewShown = useRef(false)
  const sessionEpoch = useRef(0)

  useEffect(() => {
    void api.getSession().then(async ({ username, needsReset }) => {
      setActiveUser(username)
      if (needsReset) {
        setStorageStatus('unreadable')
        return
      }
      if (username) {
        const [items, history, mode] = await Promise.all([api.listAccounts(), api.listAgentConversations(), api.getThemeMode()])
        setAccounts(items)
        if (items.length) setAccountId(items[0].id)
        setAgentConversations(history)
        setAgentConversationId(history[0]?.id || '')
        setThemeMode(mode)
      }
      setStorageStatus('ready')
    }).catch((err) => {
      setError(errorText(err))
      setStorageStatus('failed')
    })
    const unsubscribe = api.onDailyDigest((result) => {
      setDigest(result)
      setView('digest')
    })
    const unsubscribeAgent = api.onAgentProgress((progress) => setAgentStatus(progress.detail))
    const unsubscribeError = api.onAppError((message) => setError(message))
    return () => { unsubscribe(); unsubscribeAgent(); unsubscribeError() }
  }, [api])

  useEffect(() => {
    if (view !== 'agent' || !activeUser || !accounts.length || overviewShown.current) return
    overviewShown.current = true
    void loadOverview()
  }, [view, activeUser, accounts.length])

  useEffect(() => {
    if (!accountId || view !== 'mail') return
    let cancelled = false
    setMailLoading(true)
    setSelected(null)
    setDetail(null)
    void api.listMail(accountId, folder).then((items) => {
      if (!cancelled) {
        setMails(items)
        const source = pendingSource.current
        if (source && source.mail.accountId === accountId && source.mail.folder === folder) {
          pendingSource.current = null
          void openMail(source.mail, source.markRead)
        }
      }
    }).catch((err) => {
      if (!cancelled) setError(errorText(err))
    }).finally(() => {
      if (!cancelled) setMailLoading(false)
    })
    return () => { cancelled = true }
  }, [api, accountId, folder, refreshTick, view])

  const activeAccount = accounts.find((account) => account.id === accountId)

  async function login(): Promise<void> {
    setLoginBusy(true)
    setError('')
    try {
      const session = await api.login(loginName, loginPassword)
      sessionEpoch.current += 1
      setActiveUser(session.username)
      setLoginPassword('')
      setStorageStatus(session.needsReset ? 'unreadable' : 'ready')
      if (!session.needsReset) {
        const [items, history, mode] = await Promise.all([api.listAccounts(), api.listAgentConversations(), api.getThemeMode()])
        setAccounts(items)
        setAccountId(items[0]?.id || '')
        setAgentConversations(history)
        setAgentConversationId(history[0]?.id || '')
        setThemeMode(mode)
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoginBusy(false)
    }
  }

  async function logout(): Promise<void> {
    try {
      await api.logout()
    } catch (err) {
      setError(errorText(err))
      return
    }
    sessionEpoch.current += 1
    setActiveUser(null)
    setAccounts([])
    setAccountId('')
    setAccountBusy(false)
    setMails([])
    setSelected(null)
    setDetail(null)
    setMailLoading(false)
    setDetailLoading(false)
    setDigest(null)
    setDigestLoading(false)
    setAgentConversations([])
    setAgentConversationId('')
    setAgentPrompt('')
    setAgentBusy(false)
    setAgentStatus('')
    setAgentProposal(null)
    setOverview(null)
    setOverviewLoading(false)
    setOverviewError('')
    setAccountSettingsOpen(false)
    overviewShown.current = false
    setThemeMode('system')
    setFolder('INBOX')
    setView('mail')
    setSettingsOpen(false)
    setSettingsBusy(false)
    setModelsLoading(false)
    setUserOpen(false)
    setUserBusy(false)
    setNewUserName('')
    setNewUserPassword('')
    setConfirmPassword('')
    setPasswordOpen(false)
    setPasswordBusy(false)
    setCurrentPassword('')
    setNextPassword('')
    setConfirmNextPassword('')
    setPromptOpen(false)
    setPromptBusy(false)
    setPrompt('')
    setComposeOpen(false)
    setComposeBusy(false)
    setDraft(emptyDraft(''))
    setAccountForm({ provider: 'qq', address: '', authorizationCode: '' })
    setSettings({ baseUrl: '', model: '', apiKey: '', dailyTime: '09:00', autoDaily: false })
    setHasAiKey(false)
    setAvailableModels([])
    pendingSource.current = null
    setError('')
  }

  async function createUser(): Promise<void> {
    if (newUserPassword !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    setUserBusy(true)
    setError('')
    try {
      await api.createUser(newUserName, newUserPassword)
      setUserOpen(false)
      setNewUserName('')
      setNewUserPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setUserBusy(false)
    }
  }

  async function changePassword(): Promise<void> {
    if (nextPassword !== confirmNextPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    setPasswordBusy(true)
    setError('')
    try {
      await api.changePassword(currentPassword, nextPassword)
      setPasswordOpen(false)
      setCurrentPassword('')
      setNextPassword('')
      setConfirmNextPassword('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setPasswordBusy(false)
    }
  }

  async function openMail(mail: MailSummary, markRead = true): Promise<void> {
    const epoch = sessionEpoch.current
    setSelected(mail)
    setDetail(null)
    setDetailLoading(true)
    try {
      const result = await api.getMail(mail.accountId, mail.folder, mail.uid, markRead)
      if (epoch !== sessionEpoch.current) return
      setDetail(result)
      if (markRead) setMails((items) => items.map((item) => item.uid === mail.uid ? { ...item, unread: false } : item))
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setDetailLoading(false)
    }
  }

  async function showSent(): Promise<void> {
    if (!accountId) return
    const epoch = sessionEpoch.current
    try {
      const sent = await api.getSentFolder(accountId)
      if (epoch !== sessionEpoch.current) return
      if (!sent) throw new Error('邮箱服务商没有提供可识别的已发送文件夹')
      setFolder(sent)
      setView('mail')
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    }
  }

  async function addAccount(): Promise<void> {
    const epoch = sessionEpoch.current
    setAccountBusy(true)
    setError('')
    try {
      const added = await api.addAccount(accountForm)
      if (epoch !== sessionEpoch.current) return
      setAccounts((items) => [...items, added])
      setAccountId(added.id)
      setFolder('INBOX')
      setView('mail')
      setAccountOpen(false)
      setAccountForm({ provider: 'qq', address: '', authorizationCode: '' })
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setAccountBusy(false)
    }
  }

  async function removeAccount(): Promise<void> {
    if (!accountId) return
    const epoch = sessionEpoch.current
    setError('')
    try {
      await api.removeAccount(accountId)
      if (epoch !== sessionEpoch.current) return
      const remaining = accounts.filter((account) => account.id !== accountId)
      setAccounts(remaining)
      setAccountId(remaining[0]?.id || '')
      setFolder('INBOX')
      setMails([])
      setDetail(null)
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    }
  }

  async function openSettings(notice = ''): Promise<void> {
    const epoch = sessionEpoch.current
    setError('')
    try {
      const current = await api.getAiSettings()
      if (epoch !== sessionEpoch.current) return
      setSettings({ baseUrl: current.baseUrl, model: current.model, apiKey: '',
        dailyTime: current.dailyTime, autoDaily: current.autoDaily })
      setHasAiKey(current.hasApiKey)
      setAvailableModels(current.model ? [current.model] : [])
      setSettingsNotice(notice)
      setSettingsOpen(true)
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    }
  }

  async function saveSettings(): Promise<void> {
    const epoch = sessionEpoch.current
    setSettingsBusy(true)
    setError('')
    try {
      await api.saveAiSettings(settings)
      if (epoch !== sessionEpoch.current) return
      setHasAiKey(true)
      setSettingsOpen(false)
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setSettingsBusy(false)
    }
  }

  async function loadModels(): Promise<void> {
    const epoch = sessionEpoch.current
    setModelsLoading(true)
    setError('')
    try {
      const models = await api.listAiModels(settings.baseUrl, settings.apiKey)
      if (epoch !== sessionEpoch.current) return
      setAvailableModels(models)
      setSettings((current) => ({ ...current, model: models.includes(current.model) ? current.model : models[0] }))
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setModelsLoading(false)
    }
  }

  async function ensureAiConfigured(): Promise<boolean> {
    const epoch = sessionEpoch.current
    try {
      const current = await api.getAiSettings()
      if (epoch !== sessionEpoch.current) return false
      if (current.baseUrl && current.hasApiKey && current.model) return true
      await openSettings('请先填写 AI 服务地址和 API Key，然后加载并选择模型。')
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    }
    return false
  }

  async function openPrompt(): Promise<void> {
    const epoch = sessionEpoch.current
    if (!await ensureAiConfigured()) return
    if (epoch !== sessionEpoch.current) return
    setError('')
    setPrompt('')
    setPromptOpen(true)
  }

  function newMessage(reply = false): void {
    setError('')
    const recipient = reply && detail ? (detail.from.match(/<([^>]+)>/)?.[1] || detail.from) : ''
    setDraft({
      ...emptyDraft(accountId),
      to: recipient,
      subject: reply && detail ? (detail.subject.startsWith('Re:') ? detail.subject : `Re: ${detail.subject}`) : '',
      replyTo: reply && detail ? { uid: detail.uid, folder: detail.folder } : undefined
    })
    setComposePreview(false)
    setComposeOpen(true)
  }

  function openMailLink(url: string): void {
    if (url.startsWith('mailto:')) {
      const recipient = url.slice(7).split('?')[0]
      try {
        newMessage()
        setDraft({ ...emptyDraft(accountId), to: decodeURIComponent(recipient) })
      } catch {
        setError('邮件地址无效')
      }
      return
    }
    void api.openExternalLink(url).catch((err) => setError(errorText(err)))
  }

  async function generateMailDraft(): Promise<void> {
    const epoch = sessionEpoch.current
    setPromptBusy(true)
    setError('')
    try {
      const result = await api.generateDraft(prompt, accountId)
      if (epoch !== sessionEpoch.current) return
      setDraft(result)
      setComposePreview(false)
      setPromptOpen(false)
      setComposeOpen(true)
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setPromptBusy(false)
    }
  }

  async function send(): Promise<void> {
    const epoch = sessionEpoch.current
    setComposeBusy(true)
    setError('')
    try {
      await api.sendMail(draft)
      if (epoch !== sessionEpoch.current) return
      setComposeOpen(false)
      setComposePreview(false)
      setRefreshTick((value) => value + 1)
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setComposeBusy(false)
    }
  }

  async function createDigest(): Promise<void> {
    const epoch = sessionEpoch.current
    if (!await ensureAiConfigured()) return
    if (epoch !== sessionEpoch.current) return
    setDigestLoading(true)
    setError('')
    setView('digest')
    try {
      const result = await api.generateDigest(accounts.map((account) => account.id))
      if (epoch === sessionEpoch.current) setDigest(result)
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setDigestLoading(false)
    }
  }

  async function runAgent(): Promise<void> {
    if (!agentPrompt.trim() || !await ensureAiConfigured()) return
    const epoch = sessionEpoch.current
    setAgentBusy(true)
    setAgentStatus('正在理解任务')
    setAgentProposal(null)
    setError('')
    try {
      const result = await api.runAgent(agentPrompt, agentConversationId || undefined)
      if (epoch !== sessionEpoch.current) return
      setAgentConversations((current) => [result.conversation, ...current.filter((item) => item.id !== result.conversation.id)])
      setAgentConversationId(result.conversation.id)
      setAgentProposal(result.proposal || null)
      setAgentPrompt('')
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) {
        setAgentBusy(false)
        setAgentStatus('')
      }
    }
  }

  async function loadOverview(): Promise<void> {
    const epoch = sessionEpoch.current
    setOverviewLoading(true)
    setOverviewError('')
    try {
      const result = await api.getAgentOverview()
      if (epoch === sessionEpoch.current) setOverview(result)
    } catch (err) {
      if (epoch === sessionEpoch.current) setOverviewError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setOverviewLoading(false)
    }
  }

  async function changeTheme(mode: ThemeMode): Promise<void> {
    const previous = themeMode
    const epoch = sessionEpoch.current
    setThemeMode(mode)
    try {
      await api.setThemeMode(mode)
    } catch (err) {
      if (epoch === sessionEpoch.current) {
        setThemeMode(previous)
        setError(errorText(err))
      }
    }
  }

  async function confirmAgentActions(proposal: AgentProposal): Promise<void> {
    const epoch = sessionEpoch.current
    try {
      const outcome = await api.confirmAgentProposal(proposal.id)
      if (epoch !== sessionEpoch.current) return
      if (outcome.historySaved) {
        const history = await api.listAgentConversations()
        if (epoch !== sessionEpoch.current) return
        setAgentConversations(history)
      } else {
        const message: AgentMessage = {
          id: crypto.randomUUID(), role: 'assistant', createdAt: new Date().toISOString(),
          content: '整理已执行，但操作记录未能保存。', actionResults: outcome.results
        }
        setAgentConversations((current) => current.map((item) => item.id === agentConversationId
          ? { ...item, messages: [...item.messages, message] } : item))
        setError('整理已执行，但操作记录未能保存')
      }
      setAgentProposal(null)
      if (outcome.results.some((item) => item.success)) setRefreshTick((value) => value + 1)
    } catch (err) {
      if (epoch === sessionEpoch.current) {
        setAgentProposal(null)
        setError(errorText(err))
      }
      throw err
    }
  }

  function clearAgentHistory(): void {
    Modal.confirm({
      title: '清除 Agent 对话记录？',
      content: '当前用户保存的对话、引用与操作记录将被清除。',
      okText: '清除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        await api.clearAgentHistory()
        setAgentConversations([])
        setAgentConversationId('')
        setAgentProposal(null)
      }
    })
  }

  function openDigestSource(source: MailSummary): void {
    pendingSource.current = { mail: source, markRead: true }
    setAccountId(source.accountId)
    setFolder(source.folder)
    setView('mail')
  }

  function openAgentSource(source: MailSummary): void {
    pendingSource.current = { mail: source, markRead: false }
    setAccountId(source.accountId)
    setFolder(source.folder)
    setView('mail')
  }

  const activeConversation = agentConversations.find((item) => item.id === agentConversationId)

  useEffect(() => {
    if (view !== 'agent') {
      agentScrollState.current.view = view
      return
    }
    if (!agentMessagesRef.current) return
    const previous = agentScrollState.current
    const changedConversation = previous.view !== view || previous.conversationId !== agentConversationId
    agentMessagesRef.current.scrollTop = changedConversation ? 0 : agentMessagesRef.current.scrollHeight
    agentScrollState.current = { view, conversationId: agentConversationId }
  }, [view, agentConversationId, activeConversation?.messages.length, agentStatus])

  async function retryStorage(): Promise<void> {
    setStorageBusy(true)
    setError('')
    try {
      const status = await api.retryStorage()
      if (!status.needsReset) {
        const items = await api.listAccounts()
        setAccounts(items)
        if (items.length) setAccountId(items[0].id)
        setStorageStatus('ready')
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setStorageBusy(false)
    }
  }

  if (storageStatus === 'loading') return <div className="launch-screen"><Spin /></div>

  if (storageStatus !== 'ready') return <div className="recovery-shell">
    <div className="recovery-card">
      <div className="brand">Email<span>Agent</span></div>
      <h1>{storageStatus === 'failed' ? '本地配置检查失败' : '本地配置无法读取'}</h1>
      {storageStatus === 'unreadable' && <p>加密数据未被修改。重建配置时会先备份原文件，之后需要重新输入邮箱授权码和 AI Key。</p>}
      {error && <Alert type="error" message={error} style={{ marginBottom: 18 }} />}
      {storageStatus === 'unreadable' && <div className="recovery-actions"><Button loading={storageBusy} onClick={() => void retryStorage()}>重试读取</Button><Button type="primary" onClick={() => Modal.confirm({
        title: '备份并重建本地配置？',
        content: '原加密文件会保留为备份，当前账户与 AI 设置需要重新配置。',
        okText: '备份并重建', cancelText: '取消',
        onOk: async () => {
          try {
            const backup = await api.resetStorage()
            setStorageBackup(backup)
            setError('')
            setStorageStatus('ready')
          } catch (err) {
            setError(errorText(err))
            throw err
          }
        }
      })}>备份并重建配置</Button></div>}
    </div>
  </div>

  if (!activeUser) return <div className="recovery-shell">
    <div className="recovery-card">
      <div className="brand">Email<span>Agent</span></div>
      <h1>登录</h1>
      {error && <Alert type="error" message={error} style={{ marginBottom: 18 }} />}
      <div className="field"><label>账号</label><Input value={loginName}
        onChange={(event) => setLoginName(event.target.value)} /></div>
      <div className="field"><label>密码</label><Input.Password value={loginPassword}
        onChange={(event) => setLoginPassword(event.target.value)} onPressEnter={() => void login()} /></div>
      <Button type="primary" loading={loginBusy} block onClick={() => void login()}>登录</Button>
    </div>
  </div>

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">Email<span>Agent</span></div>
      <button className={`nav-item ${view === 'mail' && folder === 'INBOX' ? 'active' : ''}`}
        onClick={() => { setFolder('INBOX'); setView('mail') }}>收件箱</button>
      <button className={`nav-item ${view === 'mail' && folder !== 'INBOX' ? 'active' : ''}`}
        disabled={!accountId} onClick={() => void showSent()}>已发送</button>
      <button className={`nav-item ${view === 'digest' ? 'active' : ''}`}
        disabled={!accounts.length} onClick={() => { setView('digest'); if (!digest) void createDigest() }}>今日摘要</button>
      <button className={`nav-item ${view === 'agent' ? 'active' : ''}`}
        disabled={!accounts.length} onClick={() => setView('agent')}>对话</button>
      <div className="sidebar-label">邮箱账户</div>
      {accounts.map((account) => <button key={account.id}
        className={`account-item ${account.id === accountId ? 'active' : ''}`}
        onClick={() => { setAccountId(account.id); setFolder('INBOX'); setView('mail') }}>
        <span>{account.address}</span>
      </button>)}
      <div className="sidebar-bottom">
        <button className="account-trigger" onClick={() => setAccountSettingsOpen(true)}
          aria-label={`${activeUser}，打开设置`}>
          <span className="account-avatar">{activeUser?.slice(0, 1).toUpperCase()}</span>
          <span>{activeUser}</span>
        </button>
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>{view === 'agent' ? '对话' : view === 'digest' ? '今日摘要' : folder === 'INBOX' ? '收件箱' : '已发送'}</h1>
          {view !== 'agent' && <p>{view === 'digest' ? '汇总今天收到的邮件' : activeAccount?.address || '请先添加邮箱账户'}</p>}
        </div>
        <div className="topbar-actions">
          {view === 'mail' && <Button onClick={() => setRefreshTick((value) => value + 1)} disabled={!accountId}>刷新</Button>}
          {view === 'digest' && <Button onClick={() => void createDigest()} loading={digestLoading} disabled={!accounts.length}>重新生成</Button>}
          {view === 'agent' && <Button onClick={() => { setAgentConversationId(''); setAgentProposal(null) }}>新对话</Button>}
          <Button onClick={() => void openPrompt()} disabled={!accountId}>一句话写邮件</Button>
          <Button type="primary" onClick={() => newMessage()} disabled={!accountId}>写邮件</Button>
        </div>
      </header>

      {error && <div className="error-wrap"><Alert type="error" message={error} closable onClose={() => setError('')} /></div>}
      {storageBackup && <div className="error-wrap"><Alert type="success" message="旧加密文件已备份" description={storageBackup} closable onClose={() => setStorageBackup('')} /></div>}

      {view === 'agent' ? <section className="agent-layout">
        <div className="agent-history">
          <div className="agent-history-head"><span>对话记录</span><button onClick={clearAgentHistory}
            disabled={!agentConversations.length || agentBusy}>清除</button></div>
          {agentConversations.map((conversation) => <button key={conversation.id}
            className={`agent-history-item ${conversation.id === agentConversationId ? 'active' : ''}`}
            onClick={() => { setAgentConversationId(conversation.id); setAgentProposal(null) }}>
            {conversation.messages.find((message) => message.role === 'user')?.content || '新对话'}
          </button>)}
        </div>
        <div className="agent-chat">
          <div className="agent-messages" ref={agentMessagesRef}>
            <div className="agent-overview">
              <div className="agent-overview-head"><strong>最近 30 天</strong>
                <Button size="small" loading={overviewLoading} onClick={() => void loadOverview()}>刷新</Button></div>
              {overviewLoading && !overview ? <div className="top-spinner"><Spin /></div> : overviewError ?
                <Alert type="error" message={overviewError} /> : overview && <>
                  <div className="overview-metrics">
                    <div><span>收到</span><strong>{overview.sampled ? '至少 ' : ''}{overview.received}</strong><span>封</span></div>
                    <div><span>发出</span><strong>{overview.sampled ? '至少 ' : ''}{overview.sent}</strong><span>封</span></div>
                  </div>
                  <div className="overview-people">
                    <div><h3>常见发件人</h3>{overview.topSenders.length ? overview.topSenders.map((item) =>
                      <p key={item.address}>{item.address}<span>{item.count} 封</span></p>) : <span>暂无</span>}</div>
                    <div><h3>常见收件人</h3>{overview.topRecipients.length ? overview.topRecipients.map((item) =>
                      <p key={item.address}>{item.address}<span>{item.count} 封</span></p>) : <span>暂无</span>}</div>
                  </div>
                  <div className="overview-chart"><h3>内容星图</h3>
                    {overview.topics.length ? <React.Suspense fallback={<div className="top-spinner"><Spin /></div>}>
                      <RadarChart data={overview.topics} xField="name" yField="count"
                        height={280} theme={dark ? 'classicDark' : 'classic'} />
                    </React.Suspense> : <Empty description="暂无主题分布" />}
                  </div>
                  {overview.sampled && <div className="agent-warning">邮件数量超过检索上限，以上为抽样统计。</div>}
                  {overview.warnings.map((warning, index) => <div key={index} className="agent-warning">{warning}</div>)}
                </>}
            </div>
            {activeConversation?.messages.map((message) => <div key={message.id}
              className={`agent-message ${message.role}`}>
              <div className="agent-message-text">{message.content.split(/(\[\d+\])/g).map((part, index) => {
                const number = /^\[(\d+)\]$/.exec(part)?.[1]
                const source = message.sources?.find((item) => item.citationNumber === Number(number))
                return source ? <button key={index} className="agent-inline-source"
                  onClick={() => openAgentSource(source)}>{part}</button> : part
              })}</div>
              {message.scope && <div className="agent-scope">检索范围：{message.scope}</div>}
              {message.truncated && <div className="agent-limit">结果较多，仅分析了最近的部分邮件。请缩小检索条件。</div>}
              {message.warnings?.map((warning, index) => <div key={index} className="agent-warning">{warning}</div>)}
              {!!message.sources?.length && <div className="agent-sources">
                {message.sources.map((source, index) => <button key={`${source.accountId}-${source.folder}-${source.uid}-${index}`}
                  onClick={() => openAgentSource(source)}>[{source.citationNumber || index + 1}] 查看原文：{source.subject} · {source.from}</button>)}
              </div>}
              {message.draft && <Button onClick={() => {
                setDraft(message.draft!)
                setComposePreview(false)
                setComposeOpen(true)
              }}>打开回复草稿</Button>}
              {message.actionResults?.map((result, index) => <div key={index}
                className={result.success ? 'agent-action-ok' : 'agent-warning'}>
                {result.success ? '已完成' : '失败'}：{result.mail.subject} ·
                {result.kind === 'archive' ? '归档' : result.kind === 'markRead' ? '标记已读' : '标记未读'}
                {result.error ? `（${result.error}）` : ''}
              </div>)}
            </div>)}
            {agentBusy && <div className="agent-progress"><Spin size="small" />{agentStatus}</div>}
            {agentProposal && <div className="agent-proposal">
              <strong>待确认的整理操作</strong>
              {agentProposal.actions.map((action, index) => <div key={index}>
                {action.kind === 'archive' ? '归档' : action.kind === 'markRead' ? '标记已读' : '标记未读'} ·
                {action.mail.subject} · {action.mail.from} · {action.mail.accountAddress}
              </div>)}
              <Button type="primary" onClick={() => Modal.confirm({
                title: '确认整理这些邮件？',
                content: <div className="agent-confirm-list">{agentProposal.actions.map((action, index) => <div key={index}>
                  {action.kind === 'archive' ? '归档' : action.kind === 'markRead' ? '标记已读' : '标记未读'} ·
                  {action.mail.subject} · {action.mail.accountAddress}
                </div>)}</div>,
                okText: '确认执行', cancelText: '取消',
                onOk: () => confirmAgentActions(agentProposal)
              })}>确认整理</Button>
            </div>}
          </div>
          <div className="agent-compose">
            <Input.TextArea value={agentPrompt} rows={3} maxLength={1000}
              placeholder="例如：找出最近导师关于课程报告的邮件，总结待办并起草回复"
              onChange={(event) => setAgentPrompt(event.target.value)} />
            <Button type="primary" loading={agentBusy} disabled={!agentPrompt.trim() || !accounts.length}
              onClick={() => void runAgent()}>执行任务</Button>
          </div>
        </div>
      </section> : view === 'digest' ? <section className="digest-view">
        <div className="digest-card">
          <h2>{digest?.date || '今日'}邮件摘要</h2>
          {digestLoading ? <div className="top-spinner"><Spin /></div> : digest ? <>
            <div className="digest-body">{digest.content}</div>
            {digest.sources.length > 0 && <>
              <div className="reader-divider" />
              <h3>来源邮件</h3>
              <div className="digest-sources">{digest.sources.map((source, index) =>
                <button key={`${source.accountId}-${source.uid}`} className="source-row" onClick={() => openDigestSource(source)}>
                  [{index + 1}] {source.subject} · {source.from}
                </button>)}</div>
            </>}
          </> : <Empty description="还没有摘要" />}
        </div>
      </section> : <section className="content">
        <div className="mail-list">
          <div className="mail-list-head"><span>邮件列表</span><span>{mails.length} 封</span></div>
          {mailLoading ? <div className="top-spinner"><Spin /></div> : mails.length ? mails.map((mail) =>
            <button key={`${mail.folder}-${mail.uid}`}
              className={`mail-row ${mail.unread ? 'unread' : ''} ${selected?.uid === mail.uid ? 'selected' : ''}`}
              onClick={() => void openMail(mail)}>
              <div className="mail-row-top"><span className="mail-row-from">{mail.from}</span><span className="mail-row-date">{dateText(mail.date)}</span></div>
              <div className="mail-row-subject">{mail.subject}</div>
            </button>) : <Empty description={accountId ? '没有邮件' : '请先添加邮箱账户'} />}
        </div>
        <div className="reader">
          {detailLoading ? <div className="top-spinner"><Spin /></div> : detail ? <article className="reader-card">
            <h2>{detail.subject}</h2>
            <div className="reader-meta">
              <div><strong>发件人：</strong>{detail.from}</div>
              <div><strong>收件人：</strong>{detail.to}</div>
              <div><strong>时间：</strong>{new Date(detail.date).toLocaleString('zh-CN')}</div>
              {detail.attachmentNames.length > 0 && <div><strong>附件：</strong>{detail.attachmentNames.join('、')}</div>}
            </div>
            <div className="reader-divider" />
            {detail.html ? <MailHtmlView key={`${detail.accountId}-${detail.folder}-${detail.uid}`}
              detail={detail} onOpenLink={openMailLink} /> : <div className="mail-body">{detail.text}</div>}
            <div className="reader-actions"><Button onClick={() => newMessage(true)}>回复</Button></div>
          </article> : <div className="empty-pane"><Empty description="选择一封邮件查看" /></div>}
        </div>
      </section>}
    </main>

    <Modal open={accountSettingsOpen} title="设置" footer={null} onCancel={() => setAccountSettingsOpen(false)} destroyOnHidden>
      <div className="account-settings">
        <div className="field"><label>主题</label><Select value={themeMode}
          options={[{ label: '跟随系统', value: 'system' }, { label: '亮色', value: 'light' }, { label: '暗色', value: 'dark' }]}
          onChange={(mode: ThemeMode) => void changeTheme(mode)} /></div>
        <Button onClick={() => { setAccountSettingsOpen(false); void openSettings() }}>AI 设置</Button>
        <Button onClick={() => { setAccountSettingsOpen(false); setError(''); setAccountOpen(true) }}>添加邮箱</Button>
        <Button onClick={() => { setAccountSettingsOpen(false); setError(''); setUserOpen(true) }}>添加用户</Button>
        <Button onClick={() => { setAccountSettingsOpen(false); setError(''); setPasswordOpen(true) }}>修改密码</Button>
        <Button danger disabled={!accountId} onClick={() => { setAccountSettingsOpen(false); Modal.confirm({
          title: '移除当前邮箱？', content: '只删除本机保存的账户和授权码，不会删除服务器上的邮件。',
          okText: '移除', cancelText: '取消', okButtonProps: { danger: true }, onOk: removeAccount
        }) }}>移除当前邮箱</Button>
        <Button onClick={() => { setAccountSettingsOpen(false); void logout() }}>退出登录</Button>
      </div>
    </Modal>

    <Modal open={accountOpen} title="添加邮箱" footer={null} onCancel={() => setAccountOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>邮箱服务商</label>
        <Select value={accountForm.provider} options={[{ label: 'QQ 邮箱', value: 'qq' }, { label: '163 邮箱', value: '163' }]}
          onChange={(provider: Provider) => setAccountForm({ ...accountForm, provider, address: '' })} /></div>
      <div className="field"><label>邮箱地址</label><Input value={accountForm.address} placeholder={accountForm.provider === 'qq' ? 'name@qq.com' : 'name@163.com'}
        onChange={(event) => setAccountForm({ ...accountForm, address: event.target.value })} /></div>
      <div className="field"><label>客户端授权码</label><Input.Password value={accountForm.authorizationCode} placeholder="从邮箱设置中获取"
        onChange={(event) => setAccountForm({ ...accountForm, authorizationCode: event.target.value })} />
        <span className="field-help">请先在邮箱网页设置中开启 IMAP/SMTP。</span></div>
      <div className="modal-actions"><Button onClick={() => setAccountOpen(false)}>取消</Button><Button type="primary" loading={accountBusy} onClick={() => void addAccount()}>测试并添加</Button></div>
    </Modal>

    <Modal open={userOpen} title="添加用户" footer={null} onCancel={() => setUserOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>账号</label><Input value={newUserName}
        onChange={(event) => setNewUserName(event.target.value)} /></div>
      <div className="field"><label>密码</label><Input.Password value={newUserPassword}
        onChange={(event) => setNewUserPassword(event.target.value)} /></div>
      <div className="field"><label>确认密码</label><Input.Password value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)} /></div>
      <div className="modal-actions"><Button onClick={() => setUserOpen(false)}>取消</Button>
        <Button type="primary" loading={userBusy} onClick={() => void createUser()}>创建用户</Button></div>
    </Modal>

    <Modal open={passwordOpen} title="修改密码" footer={null} onCancel={() => setPasswordOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>当前密码</label><Input.Password value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)} /></div>
      <div className="field"><label>新密码</label><Input.Password value={nextPassword}
        onChange={(event) => setNextPassword(event.target.value)} /></div>
      <div className="field"><label>确认新密码</label><Input.Password value={confirmNextPassword}
        onChange={(event) => setConfirmNextPassword(event.target.value)} /></div>
      <div className="modal-actions"><Button onClick={() => setPasswordOpen(false)}>取消</Button>
        <Button type="primary" loading={passwordBusy} onClick={() => void changePassword()}>保存新密码</Button></div>
    </Modal>

    <Modal open={settingsOpen} title="AI 设置" footer={null} onCancel={() => setSettingsOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      {settingsNotice && <Alert type="info" message={settingsNotice} style={{ marginBottom: 16 }} />}
      <div className="field"><label>接口基础地址</label><Input value={settings.baseUrl} placeholder="https://example.com/v1"
        onChange={(event) => { setSettings({ ...settings, baseUrl: event.target.value, model: '' }); setAvailableModels([]) }} /></div>
      <div className="field"><label>API Key</label><Input.Password value={settings.apiKey} placeholder={hasAiKey ? '已保存，留空则保持不变' : '输入 API Key'}
        onChange={(event) => { setSettings({ ...settings, apiKey: event.target.value, model: '' }); setAvailableModels([]) }} /></div>
      <div className="field"><label>模型</label><div className="model-picker">
        <Select showSearch value={settings.model || undefined} placeholder="先加载模型" disabled={!availableModels.length}
          options={availableModels.map((model) => ({ label: model, value: model }))}
          onChange={(model: string) => setSettings({ ...settings, model })} />
        <Button loading={modelsLoading} onClick={() => void loadModels()}>加载模型</Button>
      </div></div>
      <p className="field-help">生成摘要时，邮件正文片段会发送给你配置的 AI 服务。</p>
      <div className="field"><label>每日摘要时间</label><Input type="time" value={settings.dailyTime}
        onChange={(event) => setSettings({ ...settings, dailyTime: event.target.value })} /></div>
      <div className="field"><label>应用运行时自动生成</label><Switch checked={settings.autoDaily}
        onChange={(checked) => setSettings({ ...settings, autoDaily: checked })} /></div>
      <div className="modal-actions"><Button onClick={() => setSettingsOpen(false)}>取消</Button><Button type="primary" loading={settingsBusy} disabled={!settings.model} onClick={() => void saveSettings()}>保存配置</Button></div>
    </Modal>

    <Modal open={promptOpen} title="一句话写邮件" footer={null} onCancel={() => setPromptOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>写信要求</label><Input.TextArea rows={5} value={prompt}
        placeholder="给 teacher@example.com 写邮件，说明周五提交课程报告，语气礼貌"
        onChange={(event) => setPrompt(event.target.value)} /></div>
      <div className="modal-actions"><Button onClick={() => setPromptOpen(false)}>取消</Button><Button type="primary" loading={promptBusy} onClick={() => void generateMailDraft()}>生成草稿</Button></div>
    </Modal>

    <Modal open={composeOpen} title={composePreview ? '确认发送' : '撰写邮件'} width={700} footer={null}
      onCancel={() => { setComposeOpen(false); setComposePreview(false) }} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      {!composePreview ? <>
        <div className="field"><label>发件账户</label><Select value={draft.accountId}
          options={accounts.map((account) => ({ label: account.address, value: account.id }))}
          onChange={(value: string) => setDraft({ ...draft, accountId: value })} /></div>
        <div className="field"><label>收件人</label><Input value={draft.to} placeholder="name@example.com"
          onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></div>
        <div className="field"><label>主题</label><Input value={draft.subject}
          onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></div>
        <div className="field"><label>正文</label><Input.TextArea rows={9} value={draft.text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></div>
        <div className="modal-actions"><Button onClick={() => setComposeOpen(false)}>取消</Button>
          <Button type="primary" onClick={() => setComposePreview(true)}>预览</Button></div>
      </> : <>
        <div className="compose-preview">
          <p><strong>发件人：</strong>{accounts.find((account) => account.id === draft.accountId)?.address}</p>
          <p><strong>收件人：</strong>{draft.to || '未填写'}</p>
          <p><strong>主题：</strong>{draft.subject || '未填写'}</p>
          <div className="reader-divider" />
          <p>{draft.text || '未填写正文'}</p>
        </div>
        <p className="small-note">确认后将立即发送。</p>
        <div className="modal-actions"><Button onClick={() => setComposePreview(false)}>返回编辑</Button>
          <Button type="primary" loading={composeBusy} onClick={() => void send()}>确认发送</Button></div>
      </>}
    </Modal>
  </div>
}

function AppRoot(): React.JSX.Element {
  const [mode, setMode] = useState<ThemeMode>('system')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setSystemDark(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const dark = mode === 'dark' || (mode === 'system' && systemDark)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    ConfigProvider.config({ theme: { algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm } })
  }, [dark])
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <EmailApp themeMode={mode} setThemeMode={setMode} dark={dark} />
  </ConfigProvider>
}

createRoot(document.getElementById('root')!).render(<AppRoot />)
