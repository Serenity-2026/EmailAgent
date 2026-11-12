export type Provider = 'qq' | '163'

export interface AccountInput {
  provider: Provider
  address: string
  authorizationCode: string
}

export interface Account {
  id: string
  provider: Provider
  address: string
}

export interface AccountConnectionStatus {
  ok: boolean
  message: string
}

export interface AccountHealth {
  accountId: string
  imap: AccountConnectionStatus
  smtp: AccountConnectionStatus
  checkedAt: string
}

export interface MailSummary {
  uid: number
  accountId: string
  folder: string
  from: string
  subject: string
  date: string
  unread: boolean
}

export interface MailFolder {
  id: string
  path: string
  name: string
  specialUse?: string
  selectable: boolean
  readOnly: boolean
}

export interface MailSearchQuery {
  subject?: string
  from?: string
  since?: string
  before?: string
  unread?: boolean
}

export interface MailListOptions {
  cursor?: string
  limit?: number
  query?: MailSearchQuery
}

export interface MailPage {
  messages: MailSummary[]
  nextCursor?: string
  truncated: boolean
  warnings: string[]
}

export interface MailDetail extends MailSummary {
  uidValidity: string
  to: string
  text: string
  html?: string
  inlineImages: { contentId: string; contentType: string; base64: string }[]
  messageId?: string
  references?: string[]
  attachmentNames: string[]
}

export interface MailDraft {
  accountId: string
  to: string
  subject: string
  text: string
  replyTo?: { uid: number; folder: string; uidValidity?: string }
}

export interface SavedDraft {
  id: string
  updatedAt: string
  draft: MailDraft
}

export interface AiSettingsInput {
  baseUrl: string
  model: string
  apiKey: string
  dailyTime: string
  autoDaily: boolean
}

export interface AiSettingsView extends Omit<AiSettingsInput, 'apiKey'> {
  hasApiKey: boolean
}

export interface DailyDigest {
  date: string
  content: string
  sources: MailSummary[]
  warnings: string[]
}

export interface DigestHistoryItem extends DailyDigest {
  generatedAt: string
  mode: 'manual' | 'auto'
}

export interface DigestFailure {
  message: string
  retriesRemaining: number
  nextRetryAt?: string
}

export interface AgentMailRef extends MailSummary {
  accountAddress: string
  uidValidity: string
  to?: string[]
  citationNumber?: number
  archiveAvailable?: boolean
}

export type ThemeMode = 'system' | 'light' | 'dark'

export interface BootstrapStatus {
  required: boolean
  demoMode: boolean
}

export interface MailOverview {
  since: string
  received: number
  sent: number
  sampled: boolean
  topSenders: { address: string; count: number }[]
  topRecipients: { address: string; count: number }[]
  topics: { name: string; count: number }[]
  warnings: string[]
}

export type AgentActionKind = 'markRead' | 'markUnread' | 'archive'

export interface AgentAction {
  kind: AgentActionKind
  mail: AgentMailRef
}

export interface AgentActionResult extends AgentAction {
  success: boolean
  error?: string
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  sources?: AgentMailRef[]
  draft?: MailDraft
  actionResults?: AgentActionResult[]
  scope?: string
  truncated?: boolean
  warnings?: string[]
}

export interface AgentConversation {
  id: string
  updatedAt: string
  messages: AgentMessage[]
}

export interface AgentProposal {
  id: string
  actions: AgentAction[]
  expiresAt: string
}

export interface AgentRunResult {
  conversation: AgentConversation
  scope: string
  truncated: boolean
  warnings: string[]
  proposal?: AgentProposal
}

export interface AgentConfirmResult {
  results: AgentActionResult[]
  historySaved: boolean
}

export interface AgentProgress {
  jobId: string
  stage: 'planning' | 'searching' | 'reading' | 'answering' | 'completed' | 'cancelled' | 'failed'
  detail: string
}

export interface AgentCancelResult {
  jobId: string
  status: 'cancelling' | 'idle'
}

export interface DesktopApi {
  getBootstrapStatus(): Promise<BootstrapStatus>
  bootstrap(username: string, password: string): Promise<{ username: string }>
  getSession(): Promise<{ username: string | null }>
  login(username: string, password: string): Promise<{ username: string }>
  logout(): Promise<void>
  createUser(username: string, password: string): Promise<void>
  changePassword(currentPassword: string, nextPassword: string): Promise<void>
  listAccounts(): Promise<Account[]>
  addAccount(input: AccountInput): Promise<Account>
  removeAccount(id: string): Promise<void>
  updateAccountAuthorizationCode(id: string, authorizationCode: string): Promise<AccountHealth>
  checkAccountHealth(id: string): Promise<AccountHealth>
  listMailFolders(accountId: string): Promise<MailFolder[]>
  listMail(accountId: string, folder: string, options?: MailListOptions): Promise<MailPage>
  getMail(accountId: string, folder: string, uid: number, markRead?: boolean): Promise<MailDetail>
  openExternalLink(url: string): Promise<void>
  getSentFolder(accountId: string): Promise<string | null>
  sendMail(draft: MailDraft): Promise<void>
  listSavedDrafts(): Promise<SavedDraft[]>
  saveDraft(id: string, draft: MailDraft): Promise<SavedDraft>
  removeSavedDraft(id: string): Promise<void>
  setComposeDirty(dirty: boolean): Promise<void>
  getAiSettings(): Promise<AiSettingsView>
  listAiModels(baseUrl: string, apiKey: string): Promise<string[]>
  saveAiSettings(input: AiSettingsInput): Promise<void>
  testAiConnection(): Promise<void>
  generateDraft(instruction: string, accountId: string): Promise<MailDraft>
  generateDigest(accountIds: string[]): Promise<DigestHistoryItem>
  listDigestHistory(): Promise<DigestHistoryItem[]>
  onDailyDigest(listener: (digest: DigestHistoryItem) => void): () => void
  onDailyDigestFailure(listener: (failure: DigestFailure) => void): () => void
  listAgentConversations(): Promise<AgentConversation[]>
  runAgent(prompt: string, conversationId: string | undefined, jobId: string): Promise<AgentRunResult>
  cancelAgentJob(jobId: string): Promise<AgentCancelResult>
  confirmAgentProposal(proposalId: string): Promise<AgentConfirmResult>
  clearAgentHistory(): Promise<void>
  onAgentProgress(listener: (progress: AgentProgress) => void): () => void
  onAppError(listener: (message: string) => void): () => void
  getAgentOverview(): Promise<MailOverview>
  getThemeMode(): Promise<ThemeMode>
  setThemeMode(mode: ThemeMode): Promise<void>
}
