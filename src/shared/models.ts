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

export interface MailSummary {
  uid: number
  accountId: string
  folder: string
  from: string
  subject: string
  date: string
  unread: boolean
}

export interface MailDetail extends MailSummary {
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
  replyTo?: { uid: number; folder: string }
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
}

export interface DesktopApi {
  getSession(): Promise<{ username: string | null; needsReset: boolean }>
  login(username: string, password: string): Promise<{ username: string; needsReset: boolean }>
  logout(): Promise<void>
  createUser(username: string, password: string): Promise<void>
  changePassword(currentPassword: string, nextPassword: string): Promise<void>
  retryStorage(): Promise<{ needsReset: boolean }>
  resetStorage(): Promise<string>
  listAccounts(): Promise<Account[]>
  addAccount(input: AccountInput): Promise<Account>
  removeAccount(id: string): Promise<void>
  listMail(accountId: string, folder: string): Promise<MailSummary[]>
  getMail(accountId: string, folder: string, uid: number): Promise<MailDetail>
  openExternalLink(url: string): Promise<void>
  getSentFolder(accountId: string): Promise<string | null>
  sendMail(draft: MailDraft): Promise<void>
  getAiSettings(): Promise<AiSettingsView>
  listAiModels(baseUrl: string, apiKey: string): Promise<string[]>
  saveAiSettings(input: AiSettingsInput): Promise<void>
  testAiConnection(): Promise<void>
  generateDraft(instruction: string, accountId: string): Promise<MailDraft>
  generateDigest(accountIds: string[]): Promise<DailyDigest>
  onDailyDigest(listener: (digest: DailyDigest) => void): () => void
}
