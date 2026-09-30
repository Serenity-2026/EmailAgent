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
  listAccounts(): Promise<Account[]>
  addAccount(input: AccountInput): Promise<Account>
  removeAccount(id: string): Promise<void>
  listMail(accountId: string, folder: string): Promise<MailSummary[]>
  getMail(accountId: string, folder: string, uid: number): Promise<MailDetail>
  getSentFolder(accountId: string): Promise<string | null>
  sendMail(draft: MailDraft): Promise<void>
  getAiSettings(): Promise<AiSettingsView>
  saveAiSettings(input: AiSettingsInput): Promise<void>
  testAiConnection(): Promise<void>
  generateDraft(instruction: string, accountId: string): Promise<MailDraft>
  generateDigest(accountIds: string[]): Promise<DailyDigest>
  onDailyDigest(listener: (digest: DailyDigest) => void): () => void
}
