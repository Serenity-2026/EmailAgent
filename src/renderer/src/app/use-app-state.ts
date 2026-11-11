import { useRef, useState } from 'react'
import type {
  Account, AccountInput, AgentConversation, AgentProposal, AiSettingsInput, DailyDigest,
  MailDetail, MailDraft, MailOverview, MailSummary
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
    userOpen, setUserOpen, newUserName, setNewUserName, newUserPassword, setNewUserPassword,
    confirmPassword, setConfirmPassword, userBusy, setUserBusy, passwordOpen, setPasswordOpen,
    currentPassword, setCurrentPassword, nextPassword, setNextPassword, confirmNextPassword, setConfirmNextPassword,
    passwordBusy, setPasswordBusy, settingsOpen, setSettingsOpen, settingsBusy, setSettingsBusy,
    settings, setSettings, hasAiKey, setHasAiKey, availableModels, setAvailableModels,
    modelsLoading, setModelsLoading, settingsNotice, setSettingsNotice }
}

export function useMailState() {
  const [folder, setFolder] = useState('INBOX')
  const [view, setView] = useState<'mail' | 'digest' | 'agent'>('mail')
  const [mails, setMails] = useState<MailSummary[]>([])
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
  return { folder, setFolder, view, setView, mails, setMails, selected, setSelected, detail, setDetail,
    mailLoading, setMailLoading, detailLoading, setDetailLoading, refreshTick, setRefreshTick,
    promptOpen, setPromptOpen, prompt, setPrompt, promptBusy, setPromptBusy, composeOpen, setComposeOpen,
    composePreview, setComposePreview, composeBusy, setComposeBusy, draft, setDraft, pendingSource }
}

export function useDigestState() {
  const [digest, setDigest] = useState<DailyDigest | null>(null)
  const [digestLoading, setDigestLoading] = useState(false)
  return { digest, setDigest, digestLoading, setDigestLoading }
}

export function useAgentState() {
  const [agentConversations, setAgentConversations] = useState<AgentConversation[]>([])
  const [agentConversationId, setAgentConversationId] = useState('')
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentStatus, setAgentStatus] = useState('')
  const [agentProposal, setAgentProposal] = useState<AgentProposal | null>(null)
  const [overview, setOverview] = useState<MailOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const agentMessagesRef = useRef<HTMLDivElement>(null)
  const agentScrollState = useRef({ view: '', conversationId: '' })
  const overviewShown = useRef(false)
  return { agentConversations, setAgentConversations, agentConversationId, setAgentConversationId,
    agentPrompt, setAgentPrompt, agentBusy, setAgentBusy, agentStatus, setAgentStatus,
    agentProposal, setAgentProposal, overview, setOverview, overviewLoading, setOverviewLoading,
    overviewError, setOverviewError, agentMessagesRef, agentScrollState, overviewShown }
}

export { emptyDraft }
