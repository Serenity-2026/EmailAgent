import React, { useEffect } from 'react'
import { Alert, Button, Modal } from 'antd'
import 'antd/dist/reset.css'
import type {
  AgentMessage, AgentProposal, DesktopApi, MailAttachment, MailFolder, MailSummary, ThemeMode
} from '../../../shared/models'
import { emptyDraft, useAccountSettingsState, useAgentState, useDigestState, useMailState, useSessionState } from './use-app-state'
import { BootstrapView, ConnectionErrorView, LaunchView, LoginView } from '../features/auth/auth-views'
import { MailView } from '../features/mail/mail-view'
import { DigestView } from '../features/digest/digest-view'
import { AgentView } from '../features/agent/agent-view'
import { SettingsDialogs } from '../features/settings/settings-dialogs'
import { ComposeDialogs } from '../features/mail/compose-dialogs'
import { Icon } from '../icons'

declare global {
  interface Window { emailAgent: DesktopApi }
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
const draftKey = (draft: ReturnType<typeof emptyDraft>): string => JSON.stringify(draft)
const hasDraftContent = (draft: ReturnType<typeof emptyDraft>): boolean =>
  Boolean(draft.to.length || draft.cc.length || draft.bcc.length || draft.subject.trim() || draft.text.trim())
const folderLabel = (folder: MailFolder): string => {
  const role = folder.specialUse?.toLowerCase()
  if (role === '\\inbox' || folder.path.toUpperCase() === 'INBOX') return '收件箱'
  if (role === '\\sent') return '已发送'
  if (role === '\\drafts') return '草稿箱'
  if (role === '\\archive') return '归档'
  if (role === '\\junk') return '垃圾邮件'
  if (role === '\\trash') return '已删除'
  return folder.name
}
interface ListSnapshot {
  mails: MailSummary[]
  nextCursor: string
  truncated: boolean
  warnings: string[]
}
const listSnapshotKey = (accountId: string, folder: string, query: object): string =>
  `${accountId}\u0000${folder}\u0000${JSON.stringify(query)}`
const pickFolder = (items: MailFolder[], desired: string): MailFolder | undefined =>
  items.find((item) => item.path === desired && item.selectable) ||
  items.find((item) => item.specialUse?.toLowerCase() === '\\inbox' && item.selectable) ||
  items.find((item) => item.path.toUpperCase() === 'INBOX' && item.selectable) ||
  items.find((item) => item.selectable)
const mergeMails = (current: MailSummary[], incoming: MailSummary[]): MailSummary[] => {
  const seen = new Set(current.map((item) => `${item.folder}\0${item.uid}`))
  return [...current, ...incoming.filter((item) => !seen.has(`${item.folder}\0${item.uid}`))]
}
export function EmailApp({ themeMode, setThemeMode, dark }: {
  themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void; dark: boolean
}): React.JSX.Element {
  const api = window.emailAgent
  const [fullscreen, setFullscreen] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    api.isFullscreen().then((value) => { if (alive) setFullscreen(value) }).catch(() => undefined)
    const off = api.onFullscreenChange((value) => setFullscreen(value))
    return () => { alive = false; off() }
  }, [api])
  const { error, setError, activeUser, setActiveUser, loginName, setLoginName, loginPassword, setLoginPassword,
    loginBusy, setLoginBusy, bootstrapRequired, setBootstrapRequired, bootstrapConfirm, setBootstrapConfirm,
    bootstrapBusy, setBootstrapBusy, demoMode, setDemoMode,
    connectionStatus, setConnectionStatus, connectionBusy, setConnectionBusy,
    sessionEpoch } = useSessionState()
  const { accounts, setAccounts, accountId, setAccountId, accountSettingsOpen, setAccountSettingsOpen,
    accountOpen, setAccountOpen, accountBusy, setAccountBusy, accountForm, setAccountForm,
    accountHealth, setAccountHealth, accountHealthBusy, setAccountHealthBusy,
    authorizationAccountId, setAuthorizationAccountId, authorizationOpen, setAuthorizationOpen,
    authorizationCode, setAuthorizationCode, authorizationBusy, setAuthorizationBusy,
    userOpen, setUserOpen, newUserName, setNewUserName, newUserPassword, setNewUserPassword,
    confirmPassword, setConfirmPassword, userBusy, setUserBusy, passwordOpen, setPasswordOpen,
    currentPassword, setCurrentPassword, nextPassword, setNextPassword, confirmNextPassword, setConfirmNextPassword,
    passwordBusy, setPasswordBusy, settingsOpen, setSettingsOpen, settingsBusy, setSettingsBusy,
    settings, setSettings, hasAiKey, setHasAiKey, availableModels, setAvailableModels, aiActivity, setAiActivity,
    modelsLoading, setModelsLoading, settingsNotice, setSettingsNotice } = useAccountSettingsState()
  const { folder, setFolder, view, setView, mails, setMails, selected, setSelected, detail, setDetail,
    folders, setFolders, folderAccountId, setFolderAccountId, foldersLoading, setFoldersLoading,
    mailNextCursor, setMailNextCursor, mailTruncated, setMailTruncated, mailWarnings, setMailWarnings,
    mailLoadingMore, setMailLoadingMore, mailQuery, setMailQuery, mailSearchDraft, setMailSearchDraft,
    mailNavigation, mailLoading, setMailLoading, detailLoading, setDetailLoading, refreshTick, setRefreshTick,
    promptOpen, setPromptOpen, prompt, setPrompt, promptBusy, setPromptBusy, composeOpen, setComposeOpen,
    composePreview, setComposePreview, composeBusy, setComposeBusy, draft, setDraft,
    savedDrafts, setSavedDrafts, activeDraftId, setActiveDraftId, draftSnapshot, setDraftSnapshot,
    draftSaving, setDraftSaving, pendingSource } = useMailState()
  const listSnapshots = React.useRef(new Map<string, ListSnapshot>())
  const folderSnapshots = React.useRef(new Map<string, MailFolder[]>())
  const forceRefresh = React.useRef(false)
  const { digest, setDigest, digestHistory, setDigestHistory, digestError, setDigestError,
    digestLoading, setDigestLoading } = useDigestState()
  const { agentConversations, setAgentConversations, agentConversationId, setAgentConversationId,
    agentPrompt, setAgentPrompt, agentBusy, setAgentBusy, agentJobId, setAgentJobId, agentJobIdRef,
    agentStatus, setAgentStatus, agentSteps, setAgentSteps,
    agentProposal, setAgentProposal, overview, setOverview, overviewLoading, setOverviewLoading,
    overviewError, setOverviewError, agentMessagesRef, agentScrollState, overviewShown } = useAgentState()
  const composeDirty = composeOpen && hasDraftContent(draft) && draftKey(draft) !== draftSnapshot

  useEffect(() => {
    void api.setComposeDirty(composeDirty).catch(() => undefined)
  }, [api, composeDirty])

  useEffect(() => () => { void api.setComposeDirty(false).catch(() => undefined) }, [api])

  useEffect(() => {
    void loadSession().catch((err) => {
      setError(errorText(err))
      setConnectionStatus('failed')
    })
    const unsubscribe = api.onDailyDigest((result) => {
      setDigest(result)
      setDigestHistory((current) => [result, ...current.filter((item) =>
        item.date !== result.date || item.mode !== result.mode)])
      setDigestError('')
      setView('digest')
    })
    const unsubscribeDigestFailure = api.onDailyDigestFailure((failure) => {
      setDigestError(failure.nextRetryAt
        ? `${failure.message}；将在 ${new Date(failure.nextRetryAt).toLocaleTimeString()} 后自动重试`
        : `${failure.message}；今日自动重试次数已用完`)
    })
    const unsubscribeAgent = api.onAgentProgress((progress) => {
      if (agentJobIdRef.current && progress.jobId !== agentJobIdRef.current) return
      setAgentStatus(progress.detail)
      if (!progress.step) return
      const step = progress.step
      setAgentSteps((current) => {
        const index = current.findIndex((item) => item.id === step.id)
        if (index < 0) return [...current, step]
        const next = [...current]
        next[index] = step
        return next
      })
    })
    const unsubscribeError = api.onAppError((message) => setError(message))
    return () => { unsubscribe(); unsubscribeDigestFailure(); unsubscribeAgent(); unsubscribeError() }
  }, [api])

  useEffect(() => {
    if (view !== 'agent' || !activeUser || !accounts.length || overviewShown.current) return
    overviewShown.current = true
    void loadOverview()
  }, [view, activeUser, accounts.length])

  useEffect(() => {
    if (!accountId) {
      setFolders([])
      setFolderAccountId('')
      return
    }
    let cancelled = false
    const saved = mailNavigation.current[accountId]
    const pending = pendingSource.current?.mail.accountId === accountId ? pendingSource.current.mail.folder : ''
    const desired = pending || saved?.folder || 'INBOX'
    const query = pending ? {} : saved?.query || {}
    const cachedFolders = folderSnapshots.current.get(accountId)
    if (cachedFolders) {
      const cachedPath = pickFolder(cachedFolders, desired)?.path || 'INBOX'
      setFolders(cachedFolders)
      setFoldersLoading(false)
      setFolder(cachedPath)
      setMailQuery(query)
      setMailSearchDraft(query)
      mailNavigation.current[accountId] = { folder: cachedPath, query }
      setFolderAccountId(accountId)
      void api.listMailFolders(accountId).then((items) => {
        if (cancelled) return
        folderSnapshots.current.set(accountId, items)
        setFolders(items)
        const refreshedPath = pickFolder(items, desired)?.path || 'INBOX'
        if (refreshedPath !== cachedPath) {
          setFolder(refreshedPath)
          mailNavigation.current[accountId] = { folder: refreshedPath, query }
          setMailWarnings(['原文件夹已不存在，已回退到可用文件夹'])
        }
      }).catch(() => undefined)
      return () => { cancelled = true }
    }
    setFoldersLoading(true)
    setMailLoading(true)
    setMails([])
    setSelected(null)
    setDetail(null)
    setMailWarnings([])
    setFolderAccountId('')
    void api.listMailFolders(accountId).then((items) => {
      if (cancelled) return
      folderSnapshots.current.set(accountId, items)
      const selectedFolder = pickFolder(items, desired)
      setFolders(items)
      setFolder(selectedFolder?.path || 'INBOX')
      setMailQuery(query)
      setMailSearchDraft(query)
      mailNavigation.current[accountId] = { folder: selectedFolder?.path || 'INBOX', query }
      if (desired !== (selectedFolder?.path || 'INBOX')) setMailWarnings(['原文件夹已不存在，已回退到可用文件夹'])
      setFolderAccountId(accountId)
    }).catch((err) => {
      if (!cancelled) {
        setFolders([])
        setMailWarnings([errorText(err)])
        setMailLoading(false)
      }
    }).finally(() => { if (!cancelled) setFoldersLoading(false) })
    return () => { cancelled = true }
  }, [api, accountId, refreshTick])

  useEffect(() => {
    if (!accountId || view !== 'mail') return
    if (folderAccountId !== accountId) return
    const key = listSnapshotKey(accountId, folder, mailQuery)
    const cached = listSnapshots.current.get(key)
    let cancelled = false
    const restorePending = (): void => {
      const source = pendingSource.current
      if (source && source.mail.accountId === accountId && source.mail.folder === folder) {
        pendingSource.current = null
        void openMail(source.mail, source.markRead)
      }
    }
    if (cached) {
      setMails(cached.mails)
      setMailNextCursor(cached.nextCursor)
      setMailTruncated(cached.truncated)
      setMailWarnings((current) => [...current.filter((warning) => warning.includes('已回退')), ...cached.warnings])
      setMailLoading(false)
      setSelected(null)
      setDetail(null)
      restorePending()
    } else {
      setMailLoading(true)
      setMailNextCursor('')
      setMailTruncated(false)
      setMailWarnings((current) => current.filter((warning) => warning.includes('已回退')))
      setSelected(null)
      setDetail(null)
    }
    const force = forceRefresh.current
    forceRefresh.current = false
    void api.listMail(accountId, folder, { limit: 50, query: mailQuery, ...(force ? { force: true } : {}) }).then((page) => {
      if (cancelled) return
      listSnapshots.current.set(key, {
        mails: page.messages, nextCursor: page.nextCursor || '', truncated: page.truncated, warnings: page.warnings
      })
      setMails(page.messages)
      setMailNextCursor(page.nextCursor || '')
      setMailTruncated(page.truncated)
      setMailWarnings((current) => [...current.filter((warning) => warning.includes('已回退')), ...page.warnings])
      restorePending()
    }).catch((err) => {
      if (!cancelled) {
        if (!cached) setMails([])
        setMailWarnings((current) => [...current, errorText(err)])
      }
    }).finally(() => {
      if (!cancelled) setMailLoading(false)
    })
    return () => { cancelled = true }
  }, [api, accountId, folder, folderAccountId, mailQuery, view])

  const activeAccount = accounts.find((account) => account.id === accountId)
  const activeFolder = folders.find((item) => item.path === folder)

  async function loadSession(): Promise<void> {
    const bootstrap = await api.getBootstrapStatus()
    setBootstrapRequired(bootstrap.required)
    setDemoMode(bootstrap.demoMode)
    if (bootstrap.required) {
      setActiveUser(null)
      setConnectionStatus('ready')
      return
    }
    const { username } = await api.getSession()
    setActiveUser(username)
    if (username) {
      const [items, history, digests, drafts, mode] = await Promise.all([
        api.listAccounts(), api.listAgentConversations(), api.listDigestHistory(), api.listSavedDrafts(), api.getThemeMode()
      ])
      setAccounts(items)
      setAccountId(items[0]?.id || '')
      setAgentConversations(history)
      setAgentConversationId(history[0]?.id || '')
      setDigestHistory(digests)
      setDigest(digests[0] || null)
      setSavedDrafts(drafts)
      setThemeMode(mode)
    }
    setConnectionStatus('ready')
  }

  async function bootstrap(): Promise<void> {
    if (loginPassword !== bootstrapConfirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBootstrapBusy(true)
    setError('')
    try {
      await api.bootstrap(loginName, loginPassword)
      sessionEpoch.current += 1
      setBootstrapRequired(false)
      setBootstrapConfirm('')
      setLoginPassword('')
      await loadSession()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBootstrapBusy(false)
    }
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
    setAccountHealth({})
    setAccountHealthBusy([])
    setAuthorizationAccountId('')
    setAuthorizationOpen(false)
    setAuthorizationCode('')
    setAuthorizationBusy(false)
    setMails([])
    setFolders([])
    setFolderAccountId('')
    setFoldersLoading(false)
    setMailNextCursor('')
    setMailTruncated(false)
    setMailWarnings([])
    setMailLoadingMore(false)
    setMailQuery({})
    setMailSearchDraft({})
    mailNavigation.current = {}
    listSnapshots.current.clear()
    folderSnapshots.current.clear()
    forceRefresh.current = false
    setSelected(null)
    setDetail(null)
    setMailLoading(false)
    setDetailLoading(false)
    setDigest(null)
    setDigestHistory([])
    setDigestError('')
    setDigestLoading(false)
    setAgentConversations([])
    setAgentConversationId('')
    setAgentPrompt('')
    setAgentBusy(false)
    setAgentJobId('')
    agentJobIdRef.current = ''
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
    setSavedDrafts([])
    setActiveDraftId('')
    setDraftSnapshot('')
    setDraftSaving(false)
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
      if (markRead) {
        const read = (item: MailSummary): MailSummary =>
          item.accountId === mail.accountId && item.folder === mail.folder && item.uid === mail.uid
            ? { ...item, unread: false } : item
        for (const snapshot of listSnapshots.current.values()) snapshot.mails = snapshot.mails.map(read)
        setMails((items) => items.map(read))
      }
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setDetailLoading(false)
    }
  }

  function selectMailFolder(path: string): void {
    if (!accountId) return
    mailNavigation.current[accountId] = { folder: path, query: mailQuery }
    setMailWarnings([])
    setFolder(path)
    setView('mail')
  }

  function refreshMail(): void {
    if (!accountId) return
    folderSnapshots.current.delete(accountId)
    for (const key of [...listSnapshots.current.keys()]) {
      if (key.startsWith(`${accountId}\u0000`)) listSnapshots.current.delete(key)
    }
    forceRefresh.current = true
    setFolderAccountId('')
    setRefreshTick((value) => value + 1)
  }

  function applyMailSearch(): void {
    if (!accountId) return
    const query = {
      ...(mailSearchDraft.subject?.trim() ? { subject: mailSearchDraft.subject.trim() } : {}),
      ...(mailSearchDraft.from?.trim() ? { from: mailSearchDraft.from.trim() } : {}),
      ...(mailSearchDraft.since ? { since: mailSearchDraft.since } : {}),
      ...(mailSearchDraft.before ? { before: mailSearchDraft.before } : {}),
      ...(mailSearchDraft.unread === undefined ? {} : { unread: mailSearchDraft.unread })
    }
    mailNavigation.current[accountId] = { folder, query }
    setMailQuery(query)
  }

  function clearMailSearch(): void {
    if (!accountId) return
    mailNavigation.current[accountId] = { folder, query: {} }
    setMailSearchDraft({})
    setMailQuery({})
  }

  async function loadMoreMail(): Promise<void> {
    if (!accountId || !mailNextCursor || mailLoadingMore) return
    const epoch = sessionEpoch.current
    const expected = { accountId, folder, cursor: mailNextCursor }
    const key = listSnapshotKey(accountId, folder, mailQuery)
    setMailLoadingMore(true)
    try {
      const page = await api.listMail(accountId, folder, { cursor: mailNextCursor, limit: 50, query: mailQuery })
      if (epoch !== sessionEpoch.current || expected.accountId !== accountId || expected.folder !== folder ||
        expected.cursor !== mailNextCursor) return
      const merged = mergeMails(mails, page.messages)
      setMails(merged)
      const snapshot = listSnapshots.current.get(key)
      if (snapshot) {
        snapshot.mails = merged
        snapshot.nextCursor = page.nextCursor || ''
        snapshot.truncated = page.truncated
        snapshot.warnings = [...new Set([...snapshot.warnings, ...page.warnings])]
      }
      setMailNextCursor(page.nextCursor || '')
      setMailTruncated(page.truncated)
      setMailWarnings((current) => [...new Set([...current, ...page.warnings])])
    } catch (err) {
      if (epoch === sessionEpoch.current) setMailWarnings((current) => [...current, errorText(err)])
    } finally {
      if (epoch === sessionEpoch.current) setMailLoadingMore(false)
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
      setView('mail')
      setAccountOpen(false)
      setAccountForm({ provider: 'qq', address: '', authorizationCode: '' })
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setAccountBusy(false)
    }
  }

  async function refreshAccountHealth(id: string): Promise<void> {
    const epoch = sessionEpoch.current
    setAccountHealthBusy((items) => items.includes(id) ? items : [...items, id])
    setError('')
    try {
      const health = await api.checkAccountHealth(id)
      if (epoch !== sessionEpoch.current) return
      setAccountHealth((items) => ({ ...items, [id]: health }))
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setAccountHealthBusy((items) => items.filter((item) => item !== id))
    }
  }

  function openAccountSettings(): void {
    setError('')
    setAccountSettingsOpen(true)
    for (const account of accounts) void refreshAccountHealth(account.id)
  }

  function openAuthorizationUpdate(id: string): void {
    setError('')
    setAccountSettingsOpen(false)
    setAuthorizationAccountId(id)
    setAuthorizationCode('')
    setAuthorizationOpen(true)
  }

  async function updateAuthorizationCode(): Promise<void> {
    if (!authorizationAccountId || !authorizationCode.trim()) return
    const epoch = sessionEpoch.current
    setAuthorizationBusy(true)
    setError('')
    try {
      const health = await api.updateAccountAuthorizationCode(authorizationAccountId, authorizationCode)
      if (epoch !== sessionEpoch.current) return
      setAccountHealth((items) => ({ ...items, [authorizationAccountId]: health }))
      setAuthorizationCode('')
      setAuthorizationOpen(false)
      setAccountSettingsOpen(true)
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setAuthorizationBusy(false)
    }
  }

  async function exportDiagnostics(): Promise<void> {
    setError('')
    try {
      const result = await api.exportDiagnostics()
      if (result.saved) Modal.success({ title: '诊断信息已导出', content: result.fileName || '文件已保存到所选位置。' })
    } catch (err) {
      setError(errorText(err))
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
      delete mailNavigation.current[accountId]
      folderSnapshots.current.delete(accountId)
      for (const key of [...listSnapshots.current.keys()]) {
        if (key.startsWith(`${accountId}\u0000`)) listSnapshots.current.delete(key)
      }
      setAccountHealth((items) => {
        const next = { ...items }
        delete next[accountId]
        return next
      })
      setAccounts(remaining)
      setSavedDrafts((items) => items.filter((item) => item.draft.accountId !== accountId))
      if (draft.accountId === accountId) {
        setComposeOpen(false)
        setActiveDraftId('')
        setDraftSnapshot('')
        setDraft(emptyDraft(remaining[0]?.id || ''))
      }
      setAccountId(remaining[0]?.id || '')
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
        dailyTime: current.dailyTime, autoDaily: current.autoDaily,
        localOnly: Boolean(current.localOnly), features: current.features || {} })
      setHasAiKey(current.hasApiKey)
      setAiActivity(current.activity || [])
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

  async function clearAiActivity(): Promise<void> {
    try {
      await api.clearAiActivity()
      setAiActivity([])
    } catch (err) {
      setError(errorText(err))
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
      to: recipient ? [recipient] : [],
      subject: reply && detail ? (detail.subject.startsWith('Re:') ? detail.subject : `Re: ${detail.subject}`) : '',
      replyTo: reply && detail ? { uid: detail.uid, folder: detail.folder, uidValidity: detail.uidValidity } : undefined
    })
    setActiveDraftId('')
    setDraftSnapshot('')
    setComposePreview(false)
    setComposeOpen(true)
  }

  function openMailLink(url: string): void {
    if (url.startsWith('mailto:')) {
      const recipient = url.slice(7).split('?')[0]
      try {
        newMessage()
        setDraft({ ...emptyDraft(accountId), to: [decodeURIComponent(recipient)] })
      } catch {
        setError('邮件地址无效')
      }
      return
    }
    void api.openExternalLink(url).catch((err) => setError(errorText(err)))
  }

  async function saveMailAttachment(attachment: MailAttachment): Promise<string | undefined> {
    if (!detail) return undefined
    const epoch = sessionEpoch.current
    setError('')
    try {
      const result = await api.saveAttachment(detail.accountId, detail.folder, detail.uid, detail.uidValidity,
        attachment.id, attachment.name)
      if (epoch !== sessionEpoch.current || !result.saved) return undefined
      return result.fileName || attachment.name
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
      return undefined
    }
  }

  async function generateMailDraft(): Promise<void> {
    const epoch = sessionEpoch.current
    setPromptBusy(true)
    setError('')
    try {
      const result = await api.generateDraft(prompt, accountId)
      if (epoch !== sessionEpoch.current) return
      setDraft(result)
      setActiveDraftId('')
      setDraftSnapshot('')
      setComposePreview(false)
      setPromptOpen(false)
      setComposeOpen(true)
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setPromptBusy(false)
    }
  }

  function closeCompose(): void {
    const close = (): void => {
      const saved = savedDrafts.find((item) => item.id === activeDraftId)
      setDraft(saved?.draft || emptyDraft(accountId))
      setDraftSnapshot(saved ? draftKey(saved.draft) : '')
      if (!saved) setActiveDraftId('')
      setComposePreview(false)
      setComposeOpen(false)
    }
    if (!composeDirty) { close(); return }
    Modal.confirm({
      title: '放弃未保存的修改？', content: '可以先保存草稿，再关闭撰写窗口。',
      okText: '放弃修改', cancelText: '继续编辑', okButtonProps: { danger: true }, onOk: close
    })
  }

  async function saveCurrentDraft(): Promise<void> {
    const epoch = sessionEpoch.current
    setDraftSaving(true)
    setError('')
    try {
      const saved = await api.saveDraft(activeDraftId, draft)
      if (epoch !== sessionEpoch.current) return
      setSavedDrafts((items) => [saved, ...items.filter((item) => item.id !== saved.id)].slice(0, 20))
      setActiveDraftId(saved.id)
      setDraftSnapshot(draftKey(saved.draft))
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setDraftSaving(false)
    }
  }

  function loadSavedDraft(id: string): void {
    const saved = savedDrafts.find((item) => item.id === id)
    if (!saved) return
    const load = (): void => {
      setDraft(saved.draft)
      setActiveDraftId(saved.id)
      setDraftSnapshot(draftKey(saved.draft))
      setComposePreview(false)
    }
    if (!composeDirty) { load(); return }
    Modal.confirm({
      title: '载入其他草稿？', content: '当前未保存的修改会被放弃。',
      okText: '载入', cancelText: '取消', onOk: load
    })
  }

  async function deleteCurrentDraft(): Promise<void> {
    if (!activeDraftId) return
    const id = activeDraftId
    const epoch = sessionEpoch.current
    setError('')
    try {
      await api.removeSavedDraft(id)
      if (epoch !== sessionEpoch.current) return
      setSavedDrafts((items) => items.filter((item) => item.id !== id))
      setActiveDraftId('')
      setDraft(emptyDraft(accountId))
      setDraftSnapshot('')
      setComposePreview(false)
    } catch (err) {
      if (epoch === sessionEpoch.current) setError(errorText(err))
    }
  }

  async function send(): Promise<void> {
    const epoch = sessionEpoch.current
    setComposeBusy(true)
    setError('')
    try {
      try {
        await api.sendMail(draft)
      } catch (err) {
        if (epoch === sessionEpoch.current) setError(errorText(err))
        return
      }
      if (epoch !== sessionEpoch.current) return
      let cleanupFailed = false
      if (activeDraftId) {
        try { await api.removeSavedDraft(activeDraftId) } catch { cleanupFailed = true }
        if (epoch !== sessionEpoch.current) return
        if (!cleanupFailed) setSavedDrafts((items) => items.filter((item) => item.id !== activeDraftId))
      }
      setComposeOpen(false)
      setComposePreview(false)
      setActiveDraftId('')
      setDraftSnapshot('')
      setDraft(emptyDraft(accountId))
      setRefreshTick((value) => value + 1)
      if (cleanupFailed) setError('邮件已发送，但已保存草稿清理失败，请手动删除该草稿')
    } finally {
      if (epoch === sessionEpoch.current) setComposeBusy(false)
    }
  }

  async function createDigest(): Promise<void> {
    const epoch = sessionEpoch.current
    if (!await ensureAiConfigured()) return
    if (epoch !== sessionEpoch.current) return
    setDigestLoading(true)
    setDigestError('')
    setError('')
    setView('digest')
    try {
      const result = await api.generateDigest(accounts.map((account) => account.id))
      if (epoch === sessionEpoch.current) {
        setDigest(result)
        setDigestHistory((current) => [result, ...current.filter((item) =>
          item.date !== result.date || item.mode !== result.mode)])
      }
    } catch (err) {
      if (epoch === sessionEpoch.current) setDigestError(errorText(err))
    } finally {
      if (epoch === sessionEpoch.current) setDigestLoading(false)
    }
  }

  async function runAgent(): Promise<void> {
    if (!agentPrompt.trim() || !await ensureAiConfigured()) return
    const epoch = sessionEpoch.current
    const jobId = crypto.randomUUID()
    setAgentBusy(true)
    setAgentJobId(jobId)
    agentJobIdRef.current = jobId
    setAgentStatus('正在理解任务')
    setAgentSteps([])
    setAgentProposal(null)
    setError('')
    try {
      const result = await api.runAgent(agentPrompt, agentConversationId || undefined, jobId)
      if (epoch !== sessionEpoch.current) return
      setAgentConversations((current) => [result.conversation, ...current.filter((item) => item.id !== result.conversation.id)])
      setAgentConversationId(result.conversation.id)
      setAgentProposal(result.proposal || null)
      setAgentPrompt('')
      setAgentStatus('任务已完成')
    } catch (err) {
      if (epoch === sessionEpoch.current) {
        const message = errorText(err)
        if (message.includes('Agent 任务已取消')) setAgentStatus('任务已取消')
        else { setAgentStatus('任务执行失败'); setError(message) }
      }
    } finally {
      if (epoch === sessionEpoch.current) {
        setAgentBusy(false)
        setAgentJobId('')
        setAgentSteps([])
        if (agentJobIdRef.current === jobId) agentJobIdRef.current = ''
      }
    }
  }

  async function cancelAgent(): Promise<void> {
    if (!agentJobId) return
    const result = await api.cancelAgentJob(agentJobId)
    if (result.status === 'cancelling') setAgentStatus('正在取消任务…')
  }

  async function loadOverview(force = false): Promise<void> {
    const epoch = sessionEpoch.current
    setOverviewLoading(true)
    setOverviewError('')
    try {
      const result = await api.getAgentOverview(force ? { force: true } : undefined)
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
    mailNavigation.current[source.accountId] = { folder: source.folder, query: {} }
    setAccountId(source.accountId)
    setFolderAccountId('')
    setRefreshTick((value) => value + 1)
    setView('mail')
  }

  function openAgentSource(source: MailSummary): void {
    pendingSource.current = { mail: source, markRead: false }
    mailNavigation.current[source.accountId] = { folder: source.folder, query: {} }
    setAccountId(source.accountId)
    setFolderAccountId('')
    setRefreshTick((value) => value + 1)
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
  if (bootstrapRequired) return <BootstrapView error={error} username={loginName} password={loginPassword}
    confirm={bootstrapConfirm} busy={bootstrapBusy} onUsername={setLoginName} onPassword={setLoginPassword}
    onConfirm={setBootstrapConfirm} onCreate={() => void bootstrap()} />
  if (!activeUser) return <LoginView error={error} username={loginName} password={loginPassword} busy={loginBusy}
    demoMode={demoMode} onUsername={setLoginName} onPassword={setLoginPassword} onLogin={() => void login()} />

  return <div className={`app-shell${fullscreen ? ' is-fullscreen' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><Icon name="mail" size={19} /><span className="brand-word">Email<span>Agent</span></span></div>
      <button className={`nav-item ${view === 'digest' ? 'active' : ''}`}
        disabled={!accounts.length} onClick={() => { setView('digest'); if (!digest) void createDigest() }}>
        <Icon name="digest" />今日摘要</button>
      <button className={`nav-item ${view === 'agent' ? 'active' : ''}`}
        disabled={!accounts.length} onClick={() => setView('agent')}>
        <Icon name="chat" />对话</button>
      <div className="sidebar-label">邮箱账户</div>
      {accounts.map((account) => <button key={account.id}
        className={`account-item ${account.id === accountId ? 'active' : ''}`}
        onClick={() => { setAccountId(account.id); setView('mail') }}>
        <span>{account.address}</span>
      </button>)}
      <div className="sidebar-label">邮箱文件夹</div>
      {foldersLoading ? <div className="sidebar-note">正在加载…</div> : folders.filter((item) => item.selectable).map((item) =>
        <button key={item.id} className={`nav-item ${view === 'mail' && item.path === folder ? 'active' : ''}`}
          onClick={() => selectMailFolder(item.path)}>{folderLabel(item)}{item.readOnly ? '（只读）' : ''}</button>)}
      <div className="sidebar-bottom">
        <button className="account-trigger" onClick={openAccountSettings}
          aria-label={`${activeUser}，打开设置`}>
          <span className="account-avatar">{activeUser?.slice(0, 1).toUpperCase()}</span>
          <span>{activeUser}</span>
        </button>
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>{view === 'agent' ? '对话' : view === 'digest' ? '今日摘要' : activeFolder ? folderLabel(activeFolder) : '邮件'}</h1>
          {view !== 'agent' && <p>{view === 'digest' ? '汇总今天收到的邮件' : activeAccount?.address || '请先添加邮箱账户'}</p>}
        </div>
        <div className="topbar-actions">
          {view === 'mail' && <Button icon={<Icon name="refresh" />} onClick={refreshMail} disabled={!accountId}>刷新</Button>}
          {view === 'digest' && <Button onClick={() => void createDigest()} loading={digestLoading} disabled={!accounts.length}>重新生成</Button>}
          {view === 'agent' && <Button onClick={() => { setAgentConversationId(''); setAgentProposal(null) }}>新对话</Button>}
          <Button onClick={() => void openPrompt()} disabled={!accountId}>一句话写邮件</Button>
          <Button type="primary" onClick={() => newMessage()} disabled={!accountId}>写邮件</Button>
        </div>
      </header>

      {error && <div className="error-wrap"><Alert type="error" message={error} closable onClose={() => setError('')} /></div>}

      {view === 'agent' ? <AgentView conversations={agentConversations} conversationId={agentConversationId}
        activeConversation={activeConversation} busy={agentBusy} status={agentStatus} steps={agentSteps}
        proposal={agentProposal}
        prompt={agentPrompt} overview={overview} overviewLoading={overviewLoading} overviewError={overviewError}
        dark={dark} accountCount={accounts.length} messagesRef={agentMessagesRef}
        onClear={clearAgentHistory} onSelectConversation={(id) => { setAgentConversationId(id); setAgentProposal(null) }}
        onLoadOverview={(force) => void loadOverview(force)} onOpenSource={openAgentSource}
        onOpenDraft={(nextDraft) => {
          setDraft(nextDraft); setActiveDraftId(''); setDraftSnapshot(''); setComposePreview(false); setComposeOpen(true)
        }}
        onConfirm={confirmAgentActions} onPrompt={setAgentPrompt} onRun={() => void runAgent()}
        onCancel={() => void cancelAgent()} onOpenLink={openMailLink} /> : view === 'digest' ?
        <DigestView digest={digest} history={digestHistory} loading={digestLoading} error={digestError}
          onSelect={(generatedAt) => setDigest(digestHistory.find((item) => item.generatedAt === generatedAt) || null)}
          onRetry={() => void createDigest()} onOpenSource={openDigestSource} onOpenLink={openMailLink} /> :
        <MailView accountId={accountId} mails={mails} selected={selected} detail={detail}
          mailLoading={mailLoading} detailLoading={detailLoading} search={mailSearchDraft}
          warnings={mailWarnings} truncated={mailTruncated} hasMore={Boolean(mailNextCursor)} loadingMore={mailLoadingMore}
          onSearch={setMailSearchDraft} onApplySearch={applyMailSearch} onClearSearch={clearMailSearch}
          onLoadMore={() => void loadMoreMail()}
          onOpenMail={(mail) => void openMail(mail)} onOpenLink={openMailLink}
          onSaveAttachment={saveMailAttachment} onReply={() => newMessage(true)} />}
    </main>

    <SettingsDialogs error={error} themeMode={themeMode} accountSettingsOpen={accountSettingsOpen}
      accountOpen={accountOpen} accountBusy={accountBusy} accountForm={accountForm}
      accounts={accounts} accountHealth={accountHealth} accountHealthBusy={accountHealthBusy}
      authorizationOpen={authorizationOpen} authorizationAccount={accounts.find((item) => item.id === authorizationAccountId)}
      authorizationCode={authorizationCode} authorizationBusy={authorizationBusy}
      userOpen={userOpen} userBusy={userBusy} newUserName={newUserName} newUserPassword={newUserPassword}
      confirmPassword={confirmPassword} passwordOpen={passwordOpen} passwordBusy={passwordBusy}
      currentPassword={currentPassword} nextPassword={nextPassword} confirmNextPassword={confirmNextPassword}
      aiOpen={settingsOpen} aiBusy={settingsBusy} aiSettings={settings} hasAiKey={hasAiKey} aiActivity={aiActivity}
      models={availableModels} modelsLoading={modelsLoading} notice={settingsNotice} hasAccount={Boolean(accountId)}
      onTheme={(mode) => void changeTheme(mode)} onAccountSettingsOpen={setAccountSettingsOpen}
      onOpenAi={() => { setAccountSettingsOpen(false); void openSettings() }}
      onOpenAccount={() => { setAccountSettingsOpen(false); setError(''); setAccountOpen(true) }}
      onOpenUser={() => { setAccountSettingsOpen(false); setError(''); setUserOpen(true) }}
      onOpenPassword={() => { setAccountSettingsOpen(false); setError(''); setPasswordOpen(true) }}
      onRemoveAccount={removeAccount} onExportDiagnostics={() => void exportDiagnostics()}
      onLogout={() => { setAccountSettingsOpen(false); void logout() }}
      onCheckAccount={(id) => void refreshAccountHealth(id)} onOpenAuthorization={openAuthorizationUpdate}
      onAuthorizationOpen={setAuthorizationOpen} onAuthorizationCode={setAuthorizationCode}
      onUpdateAuthorization={() => void updateAuthorizationCode()}
      onAccountOpen={setAccountOpen} onAccountForm={setAccountForm} onAddAccount={() => void addAccount()}
      onUserOpen={setUserOpen} onNewUserName={setNewUserName} onNewUserPassword={setNewUserPassword}
      onConfirmPassword={setConfirmPassword} onCreateUser={() => void createUser()}
      onPasswordOpen={setPasswordOpen} onCurrentPassword={setCurrentPassword} onNextPassword={setNextPassword}
      onConfirmNextPassword={setConfirmNextPassword} onChangePassword={() => void changePassword()}
      onAiOpen={setSettingsOpen} onAiSettings={setSettings} onModels={setAvailableModels}
      onLoadModels={() => void loadModels()} onSaveAi={() => void saveSettings()} onClearActivity={() => void clearAiActivity()} />

    <ComposeDialogs error={error} accounts={accounts} promptOpen={promptOpen} prompt={prompt}
      promptBusy={promptBusy} composeOpen={composeOpen} preview={composePreview} composeBusy={composeBusy}
      draft={draft} savedDrafts={savedDrafts} activeDraftId={activeDraftId} draftSaving={draftSaving} dirty={composeDirty}
      onPromptOpen={setPromptOpen} onPrompt={setPrompt} onGenerate={() => void generateMailDraft()}
      onClose={closeCompose} onPreview={setComposePreview} onDraft={setDraft}
      onSaveDraft={() => void saveCurrentDraft()} onLoadDraft={loadSavedDraft}
      onDeleteDraft={() => void deleteCurrentDraft()} onSend={() => void send()} />
  </div>
}
