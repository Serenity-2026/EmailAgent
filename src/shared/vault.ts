import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import type { Account, AgentConversation, AiActivityEntry, AiSettingsInput, DigestHistoryItem, MailDraft, MailSummary, SavedDraft, ThemeMode } from './models'

export interface StoredAccount extends Account {
  authorizationCode: string
}

export interface StoredData {
  accounts: StoredAccount[]
  ai: AiSettingsInput
  digestHistory?: DigestHistoryItem[]
  agentConversations?: AgentConversation[]
  savedDrafts?: SavedDraft[]
  themeMode?: ThemeMode
  aiActivity?: AiActivityEntry[]
}

export interface UserVault {
  username: string
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export interface VaultFile {
  version: 2
  users: UserVault[]
}

export const emptyData = (): StoredData => ({
  accounts: [],
  ai: {
    baseUrl: '', model: '', apiKey: '', dailyTime: '09:00', autoDaily: false,
    localOnly: false, features: { digest: true, draft: true, agent: true, topics: true }
  },
  digestHistory: [],
  agentConversations: [],
  savedDrafts: [],
  themeMode: 'system',
  aiActivity: []
})

export function currentConversations(items: unknown): AgentConversation[] {
  if (!Array.isArray(items)) return []
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  return (items as AgentConversation[]).filter((item) => item && typeof item.id === 'string' &&
    typeof item.updatedAt === 'string' && Array.isArray(item.messages) &&
    Number.isFinite(Date.parse(item.updatedAt)) && Date.parse(item.updatedAt) >= cutoff)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30)
    .map((item) => ({ ...item, messages: item.messages.filter((message) =>
      typeof message.createdAt === 'string' && Number.isFinite(Date.parse(message.createdAt)) &&
      Date.parse(message.createdAt) >= cutoff).slice(-40).map((message) => {
        const draft = normalizeMailDraft((message as unknown as { draft?: unknown }).draft)
        return { ...message, draft: draft || undefined }
      }) }))
    .filter((item) => item.messages.length > 0)
}

function digestSource(value: unknown): MailSummary | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (!Number.isSafeInteger(source.uid) || Number(source.uid) <= 0 ||
    !['accountId', 'folder', 'from', 'subject', 'date'].every((key) => typeof source[key] === 'string') ||
    typeof source.unread !== 'boolean') return null
  return {
    uid: Number(source.uid), accountId: source.accountId as string, folder: source.folder as string,
    from: source.from as string, subject: source.subject as string, date: source.date as string,
    unread: source.unread
  }
}

export function currentDigestHistory(items: unknown, now = Date.now()): DigestHistoryItem[] {
  if (!Array.isArray(items)) return []
  const cutoff = now - 7 * 24 * 60 * 60 * 1000
  const unique = new Set<string>()
  return (items as unknown[]).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const generated = typeof item.generatedAt === 'string' ? Date.parse(item.generatedAt) : NaN
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.date)) || !Number.isFinite(generated) || generated < cutoff || generated > now + 300_000 ||
      (item.mode !== 'manual' && item.mode !== 'auto') || typeof item.content !== 'string' || !Array.isArray(item.sources) ||
      !Array.isArray(item.warnings) || item.warnings.some((warning) => typeof warning !== 'string')) return []
    const sources = item.sources.map(digestSource)
    if (sources.some((source) => !source)) return []
    return [{
      date: item.date as string, generatedAt: item.generatedAt as string, mode: item.mode,
      content: item.content, sources: sources as MailSummary[], warnings: item.warnings as string[]
    } satisfies DigestHistoryItem]
  }).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).filter((item) => {
    const key = `${item.date}\0${item.mode}`
    if (unique.has(key)) return false
    unique.add(key)
    return true
  }).slice(0, 14)
}

function recipientList(value: unknown): string[] | null {
  const entries = typeof value === 'string' ? (value.trim() ? [value] : []) : value
  if (!Array.isArray(entries) || entries.length > 50 || entries.some((item) => typeof item !== 'string' || item.length > 320)) return null
  return entries.map((item) => item.trim()).filter(Boolean)
}

export function normalizeMailDraft(value: unknown): MailDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Record<string, unknown>
  const to = recipientList(draft.to)
  const cc = draft.cc === undefined ? [] : recipientList(draft.cc)
  const bcc = draft.bcc === undefined ? [] : recipientList(draft.bcc)
  if (typeof draft.accountId !== 'string' || !to || !cc || !bcc || to.length + cc.length + bcc.length > 50 ||
    typeof draft.subject !== 'string' || draft.subject.length > 2000 ||
    typeof draft.text !== 'string' || draft.text.length > 1_000_000) return null
  const seen = new Set<string>()
  const unique = (items: string[]): string[] => items.filter((item) => {
    const key = item.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  let replyTo: MailDraft['replyTo']
  if (draft.replyTo !== undefined) {
    if (!draft.replyTo || typeof draft.replyTo !== 'object') return null
    const reply = draft.replyTo as Record<string, unknown>
    if (!Number.isSafeInteger(reply.uid) || Number(reply.uid) <= 0 || typeof reply.folder !== 'string' ||
      (reply.uidValidity !== undefined && typeof reply.uidValidity !== 'string')) return null
    replyTo = { uid: Number(reply.uid), folder: reply.folder, ...(reply.uidValidity === undefined ? {} : { uidValidity: reply.uidValidity as string }) }
  }
  return { accountId: draft.accountId, to: unique(to), cc: unique(cc), bcc: unique(bcc),
    subject: draft.subject, text: draft.text, ...(replyTo ? { replyTo } : {}) }
}

export function currentSavedDrafts(items: unknown): SavedDraft[] {
  if (!Array.isArray(items)) return []
  const ids = new Set<string>()
  return items.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const timestamp = typeof item.updatedAt === 'string' ? Date.parse(item.updatedAt) : NaN
    const draft = normalizeMailDraft(item.draft)
    if (typeof item.id !== 'string' || !item.id || item.id.length > 100 || !Number.isFinite(timestamp) || !draft) return []
    return [{ id: item.id, updatedAt: item.updatedAt as string, draft } satisfies SavedDraft]
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((item) => {
    if (ids.has(item.id)) return false
    ids.add(item.id)
    return true
  }).slice(0, 20)
}

export function currentAiActivity(items: unknown): AiActivityEntry[] {
  if (!Array.isArray(items)) return []
  const features = new Set(['digest', 'draft', 'agent', 'topics'])
  return (items as unknown[]).filter((item): item is AiActivityEntry => {
    if (!item || typeof item !== 'object') return false
    const entry = item as Record<string, unknown>
    return typeof entry.at === 'string' && Number.isFinite(Date.parse(entry.at)) &&
      typeof entry.feature === 'string' && features.has(entry.feature) &&
      typeof entry.host === 'string' && entry.host.length <= 200 &&
      Number.isSafeInteger(entry.mails) && Number(entry.mails) >= 0 &&
      Number.isSafeInteger(entry.characters) && Number(entry.characters) >= 0 &&
      typeof entry.ok === 'boolean' &&
      (entry.skipped === undefined || (Number.isSafeInteger(entry.skipped) && Number(entry.skipped) >= 0))
  }).slice(0, 20)
}

function isStoredData(value: unknown): value is StoredData {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return Array.isArray(data.accounts) && !!data.ai && typeof data.ai === 'object'
}

export function keyFor(password: string, salt: string): Buffer {
  return scryptSync(password, Buffer.from(salt, 'base64'), 32)
}

export function decryptVault(vault: UserVault, key: Buffer): StoredData {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(vault.iv, 'base64'))
  decipher.setAAD(Buffer.from(vault.username, 'utf8'))
  decipher.setAuthTag(Buffer.from(vault.tag, 'base64'))
  const plain = Buffer.concat([
    decipher.update(Buffer.from(vault.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8')
  const parsed: unknown = JSON.parse(plain)
  if (!isStoredData(parsed)) throw new Error('配置格式无效')
  return { ...parsed, aiActivity: currentAiActivity(parsed.aiActivity) }
}

export function encryptVault(username: string, salt: string, key: Buffer, data: StoredData): UserVault {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(username, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return {
    username,
    salt,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}
