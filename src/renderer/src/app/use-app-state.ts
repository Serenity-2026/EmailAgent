import { useRef, useState } from 'react'
import type {
  Account, AccountHealth, AccountInput, AgentConversation, AgentProposal, AiSettingsInput, DigestHistoryItem,
  MailDetail, MailDraft, MailFolder, MailOverview, MailSearchQuery, MailSummary
} from '../../../shared/models'

const emptyDraft = (accountId: string): MailDraft => ({ accountId, to: '', subject: '', text: '' })

export function useSessionState() {
  const [error, setError] = useState('')
  const [activeUser, setActiveUser] = useState<string | null>(null)
  const [loginName, setLoginName] = useState('dmc')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [bootstrapRequired, setBootstrapRequired] = useState(false)
  const [bootstrapConfirm, setBootstrapConfirm] = useState('')
  const [bootstrapBusy, setBootstrapBusy] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [connectionBusy, setConnectionBusy] = useState(false)
  const sessionEpoch = useRef(0)
  return { error, setError, activeUser, setActiveUser, loginName, setLoginName, loginPassword, setLoginPassword,
    loginBusy, setLoginBusy, bootstrapRequired, setBootstrapRequired, bootstrapConfirm, setBootstrapConfirm,
    bootstrapBusy, setBootstrapBusy, demoMode, setDemoMode,
    connectionStatus, setConnectionStatus, connectionBusy, setConnectionBusy, sessionEpoch }
}

export function useAccountSettingsState() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountForm, setAccountForm] = useState<AccountInput>({ provider: 'qq', address: '', authorizationCode: '' })
  const [accountHealth, setAccountHealth] = useState<Record<string, AccountHealth>>({})
  const [accountHealthBusy, setAccountHealthBusy] = useState<string[]>([])
  const [authorizationAccountId, setAuthorizationAccountId] = useState('')
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [authorizationCode, setAuthorizationCode] = useState('')
  const [authorizationBusy, setAuthorizationBusy] = useState(false)
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settings, setSettings] = useState<AiSettingsInput>({ baseUrl: '', model: '', apiKey: '', dailyTime: '09:00', autoDaily: false })
  const [hasAiKey, setHasAiKey] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [settingsNotice, setSettingsNotice] = useState('')
  return { accounts, setAccounts, accountId, setAccountId, accountSettingsOpen, setAccountSettingsOpen,
    accountOpen, setAccountOpen, accountBusy, setAccountBusy, accountForm, setAccountForm,
    accountHealth, setAccountHealth, accountHealthBusy, setAccountHealthBusy,
    authorizationAccountId, setAuthorizationAccountId, authorizationOpen, setAuthorizationOpen,
    authorizationCode, setAuthorizationCode, authorizationBusy, setAuthorizationBusy,
    userOpen, setUserOpen, newUserName, setNewUserName, newUserPassword, setNewUserPassword,
    confirmPassword, setConfirmPassword, userBusy, setUserBusy, passwordOpen, setPasswordOpen,
    currentPassword, setCurrentPassword, nextPassword, setNextPassword, confirmNextPassword, setConfirmNextPassword,
    passwordBusy, setPasswordBusy, settingsOpen, setSettingsOpen, settingsBusy, setSettingsBusy,
    settings, setSettings, hasAiKey, setHasAiKey, availableModels, setAvailableModels,
    modelsLoading, setModelsLoading, settingsNotice, setSettingsNotice }
}

export function useMailState() {
  const [folder, setFolder] = useState('INBOX')
  const [folders, setFolders] = useState<MailFolder[]>([])
  const [folderAccountId, setFolderAccountId] = useState('')
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [view, setView] = useState<'mail' | 'digest' | 'agent'>('mail')
  const [mails, setMails] = useState<MailSummary[]>([])
  const [mailNextCursor, setMailNextCursor] = useState('')
  const [mailTruncated, setMailTruncated] = useState(false)
  const [mailWarnings, setMailWarnings] = useState<string[]>([])
  const [mailLoadingMore, setMailLoadingMore] = useState(false)
  const [mailQuery, setMailQuery] = useState<MailSearchQuery>({})
  const [mailSearchDraft, setMailSearchDraft] = useState<MailSearchQuery>({})
  const mailNavigation = useRef<Record<string, { folder: string; query: MailSearchQuery }>>({})
  const [selected, setSelected] = useState<MailSummary | null>(null)
  const [detail, setDetail] = useState<MailDetail | null>(null)
  const [mailLoading, setMailLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [promptOpen, setPromptOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [promptBusy, setPromptBusy] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composePreview, setComposePreview] = useState(false)
  const [composeBusy, setComposeBusy] = useState(false)
  const [draft, setDraft] = useState<MailDraft>(emptyDraft(''))
  const pendingSource = useRef<{ mail: MailSummary; markRead: boolean } | null>(null)
  return { folder, setFolder, folders, setFolders, folderAccountId, setFolderAccountId,
    foldersLoading, setFoldersLoading, view, setView, mails, setMails, mailNextCursor, setMailNextCursor,
    mailTruncated, setMailTruncated, mailWarnings, setMailWarnings, mailLoadingMore, setMailLoadingMore,
    mailQuery, setMailQuery, mailSearchDraft, setMailSearchDraft, mailNavigation,
    selected, setSelected, detail, setDetail, mailLoading, setMailLoading,
    detailLoading, setDetailLoading, refreshTick, setRefreshTick,
    promptOpen, setPromptOpen, prompt, setPrompt, promptBusy, setPromptBusy, composeOpen, setComposeOpen,
    composePreview, setComposePreview, composeBusy, setComposeBusy, draft, setDraft, pendingSource }
}

export function useDigestState() {
  const [digest, setDigest] = useState<DigestHistoryItem | null>(null)
  const [digestHistory, setDigestHistory] = useState<DigestHistoryItem[]>([])
  const [digestError, setDigestError] = useState('')
  const [digestLoading, setDigestLoading] = useState(false)
  return { digest, setDigest, digestHistory, setDigestHistory, digestError, setDigestError,
    digestLoading, setDigestLoading }
}

export function useAgentState() {
  const [agentConversations, setAgentConversations] = useState<AgentConversation[]>([])
  const [agentConversationId, setAgentConversationId] = useState('')
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentJobId, setAgentJobId] = useState('')
  const agentJobIdRef = useRef('')
  const [agentStatus, setAgentStatus] = useState('')
  const [agentProposal, setAgentProposal] = useState<AgentProposal | null>(null)
  const [overview, setOverview] = useState<MailOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const agentMessagesRef = useRef<HTMLDivElement>(null)
  const agentScrollState = useRef({ view: '', conversationId: '' })
  const overviewShown = useRef(false)
  return { agentConversations, setAgentConversations, agentConversationId, setAgentConversationId,
    agentPrompt, setAgentPrompt, agentBusy, setAgentBusy, agentJobId, setAgentJobId, agentJobIdRef,
    agentStatus, setAgentStatus,
    agentProposal, setAgentProposal, overview, setOverview, overviewLoading, setOverviewLoading,
    overviewError, setOverviewError, agentMessagesRef, agentScrollState, overviewShown }
}

export { emptyDraft }
