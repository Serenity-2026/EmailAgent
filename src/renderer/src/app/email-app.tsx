import React, { useEffect } from 'react'
import { Alert, Button, Modal } from 'antd'
import 'antd/dist/reset.css'
import type {
  AgentMessage, AgentProposal, DesktopApi, MailSummary, ThemeMode
} from '../../../shared/models'
import { emptyDraft, useAccountSettingsState, useAgentState, useDigestState, useMailState, useSessionState } from './use-app-state'
import { ConnectionErrorView, LaunchView, LoginView } from '../features/auth/auth-views'
import { MailView } from '../features/mail/mail-view'
import { DigestView } from '../features/digest/digest-view'
import { AgentView } from '../features/agent/agent-view'
import { SettingsDialogs } from '../features/settings/settings-dialogs'
import { ComposeDialogs } from '../features/mail/compose-dialogs'

declare global {
  interface Window { emailAgent: DesktopApi }
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
export function EmailApp({ themeMode, setThemeMode, dark }: {
  themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void; dark: boolean
}): React.JSX.Element {
  const api = window.emailAgent
  const { error, setError, activeUser, setActiveUser, loginName, setLoginName, loginPassword, setLoginPassword,
    loginBusy, setLoginBusy, connectionStatus, setConnectionStatus, connectionBusy, setConnectionBusy,
    sessionEpoch } = useSessionState()
  const { accounts, setAccounts, accountId, setAccountId, accountSettingsOpen, setAccountSettingsOpen,
    accountOpen, setAccountOpen, accountBusy, setAccountBusy, accountForm, setAccountForm,
    userOpen, setUserOpen, newUserName, setNewUserName, newUserPassword, setNewUserPassword,
    confirmPassword, setConfirmPassword, userBusy, setUserBusy, passwordOpen, setPasswordOpen,
    currentPassword, setCurrentPassword, nextPassword, setNextPassword, confirmNextPassword, setConfirmNextPassword,
    passwordBusy, setPasswordBusy, settingsOpen, setSettingsOpen, settingsBusy, setSettingsBusy,
    settings, setSettings, hasAiKey, setHasAiKey, availableModels, setAvailableModels,
    modelsLoading, setModelsLoading, settingsNotice, setSettingsNotice } = useAccountSettingsState()
  const { folder, setFolder, view, setView, mails, setMails, selected, setSelected, detail, setDetail,
    mailLoading, setMailLoading, detailLoading, setDetailLoading, refreshTick, setRefreshTick,
    promptOpen, setPromptOpen, prompt, setPrompt, promptBusy, setPromptBusy, composeOpen, setComposeOpen,
    composePreview, setComposePreview, composeBusy, setComposeBusy, draft, setDraft, pendingSource } = useMailState()
  const { digest, setDigest, digestLoading, setDigestLoading } = useDigestState()
  const { agentConversations, setAgentConversations, agentConversationId, setAgentConversationId,
    agentPrompt, setAgentPrompt, agentBusy, setAgentBusy, agentStatus, setAgentStatus,
    agentProposal, setAgentProposal, overview, setOverview, overviewLoading, setOverviewLoading,
    overviewError, setOverviewError, agentMessagesRef, agentScrollState, overviewShown } = useAgentState()

  useEffect(() => {
    void loadSession().catch((err) => {
      setError(errorText(err))
      setConnectionStatus('failed')
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

  async function loadSession(): Promise<void> {
    const { username } = await api.getSession()
    setActiveUser(username)
    if (username) {
      const [items, history, mode] = await Promise.all([api.listAccounts(), api.listAgentConversations(), api.getThemeMode()])
      setAccounts(items)
      setAccountId(items[0]?.id || '')
      setAgentConversations(history)
      setAgentConversationId(history[0]?.id || '')
      setThemeMode(mode)
    }
    setConnectionStatus('ready')
  }

  async function login(): Promise<void> {
    setLoginBusy(true)
    setError('')
    try {
      await api.login(loginName, loginPassword)
      sessionEpoch.current += 1
      setLoginPassword('')
      await loadSession()
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
      replyTo: reply && detail ? { uid: detail.uid, folder: detail.folder, uidValidity: detail.uidValidity } : undefined
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

  async function retryConnection(): Promise<void> {
    setConnectionBusy(true)
    setError('')
    try {
      await loadSession()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setConnectionBusy(false)
    }
  }

  if (connectionStatus === 'loading') return <LaunchView />
  if (connectionStatus !== 'ready') return <ConnectionErrorView error={error} busy={connectionBusy} onRetry={() => void retryConnection()} />
  if (!activeUser) return <LoginView error={error} username={loginName} password={loginPassword} busy={loginBusy}
    onUsername={setLoginName} onPassword={setLoginPassword} onLogin={() => void login()} />

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

      {view === 'agent' ? <AgentView conversations={agentConversations} conversationId={agentConversationId}
        activeConversation={activeConversation} busy={agentBusy} status={agentStatus} proposal={agentProposal}
        prompt={agentPrompt} overview={overview} overviewLoading={overviewLoading} overviewError={overviewError}
        dark={dark} accountCount={accounts.length} messagesRef={agentMessagesRef}
        onClear={clearAgentHistory} onSelectConversation={(id) => { setAgentConversationId(id); setAgentProposal(null) }}
        onLoadOverview={() => void loadOverview()} onOpenSource={openAgentSource}
        onOpenDraft={(nextDraft) => { setDraft(nextDraft); setComposePreview(false); setComposeOpen(true) }}
        onConfirm={confirmAgentActions} onPrompt={setAgentPrompt} onRun={() => void runAgent()} /> : view === 'digest' ?
        <DigestView digest={digest} loading={digestLoading} onOpenSource={openDigestSource} /> :
        <MailView accountId={accountId} mails={mails} selected={selected} detail={detail}
          mailLoading={mailLoading} detailLoading={detailLoading}
          onOpenMail={(mail) => void openMail(mail)} onOpenLink={openMailLink} onReply={() => newMessage(true)} />}
    </main>

    <SettingsDialogs error={error} themeMode={themeMode} accountSettingsOpen={accountSettingsOpen}
      accountOpen={accountOpen} accountBusy={accountBusy} accountForm={accountForm}
      userOpen={userOpen} userBusy={userBusy} newUserName={newUserName} newUserPassword={newUserPassword}
      confirmPassword={confirmPassword} passwordOpen={passwordOpen} passwordBusy={passwordBusy}
      currentPassword={currentPassword} nextPassword={nextPassword} confirmNextPassword={confirmNextPassword}
      aiOpen={settingsOpen} aiBusy={settingsBusy} aiSettings={settings} hasAiKey={hasAiKey}
      models={availableModels} modelsLoading={modelsLoading} notice={settingsNotice} hasAccount={Boolean(accountId)}
      onTheme={(mode) => void changeTheme(mode)} onAccountSettingsOpen={setAccountSettingsOpen}
      onOpenAi={() => { setAccountSettingsOpen(false); void openSettings() }}
      onOpenAccount={() => { setAccountSettingsOpen(false); setError(''); setAccountOpen(true) }}
      onOpenUser={() => { setAccountSettingsOpen(false); setError(''); setUserOpen(true) }}
      onOpenPassword={() => { setAccountSettingsOpen(false); setError(''); setPasswordOpen(true) }}
      onRemoveAccount={removeAccount} onLogout={() => { setAccountSettingsOpen(false); void logout() }}
      onAccountOpen={setAccountOpen} onAccountForm={setAccountForm} onAddAccount={() => void addAccount()}
      onUserOpen={setUserOpen} onNewUserName={setNewUserName} onNewUserPassword={setNewUserPassword}
      onConfirmPassword={setConfirmPassword} onCreateUser={() => void createUser()}
      onPasswordOpen={setPasswordOpen} onCurrentPassword={setCurrentPassword} onNextPassword={setNextPassword}
      onConfirmNextPassword={setConfirmNextPassword} onChangePassword={() => void changePassword()}
      onAiOpen={setSettingsOpen} onAiSettings={setSettings} onModels={setAvailableModels}
      onLoadModels={() => void loadModels()} onSaveAi={() => void saveSettings()} />

    <ComposeDialogs error={error} accounts={accounts} promptOpen={promptOpen} prompt={prompt}
      promptBusy={promptBusy} composeOpen={composeOpen} preview={composePreview} composeBusy={composeBusy}
      draft={draft} onPromptOpen={setPromptOpen} onPrompt={setPrompt} onGenerate={() => void generateMailDraft()}
      onComposeOpen={setComposeOpen} onPreview={setComposePreview} onDraft={setDraft} onSend={() => void send()} />
  </div>
}
