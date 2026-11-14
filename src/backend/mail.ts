import { ImapFlow, type FetchMessageObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import type {
  AccountHealth, AgentAction, AgentMailRef, AttachmentDownload, MailAttachment, MailDetail, MailDraft, MailFolder, MailListOptions, MailPage,
  MailSearchQuery, MailSummary
} from '../shared/models'
import { attachmentDownloadReason, sanitizeAttachmentFilename } from '../shared/attachments'
import { mailListCache, type MailboxSnapshot, type MailListEntry } from './mail-cache'
import { PROVIDERS, validateRecipients } from './providers'
import type { StoredAccount } from '../shared/vault'

export const MAX_INTERACTIVE_MAIL_BYTES = 20_000_000
export const MAX_AI_MAIL_BYTES = 5_000_000
const MAIL_PAGE_SIZE = 50
const MAX_SEARCH_RESULTS = 200

type ParsedAttachment = Awaited<ReturnType<typeof simpleParser>>['attachments'][number]

interface FolderListing {
  path: string
  name: string
  specialUse?: string | false
  flags?: Set<string>
}

interface MailCursor {
  version: 1
  folder: string
  uidValidity: string
  beforeUid: number
  queryKey: string
  remaining?: number
  truncated: boolean
}

function clientFor(account: StoredAccount): ImapFlow {
  const client = new ImapFlow({
    host: PROVIDERS[account.provider].imap,
    port: 993,
    secure: true,
    auth: { user: account.address, pass: account.authorizationCode },
    connectionTimeout: 15_000,
    logger: false
  })
  // ImapFlow can emit a connection error in addition to rejecting the active request.
  // EventEmitter treats an unhandled error event as a main-process exception.
  client.on('error', () => undefined)
  return client
}

async function withImap<T>(account: StoredAccount, action: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = clientFor(account)
  try {
    await client.connect()
    return await action(client)
  } finally {
    await client.logout().catch(() => undefined)
  }
}

async function testImap(account: StoredAccount): Promise<void> {
  await withImap(account, async () => undefined)
}

async function testSmtp(account: StoredAccount): Promise<void> {
  const transport = nodemailer.createTransport({
    host: PROVIDERS[account.provider].smtp,
    port: 465,
    secure: true,
    auth: { user: account.address, pass: account.authorizationCode },
    connectionTimeout: 15_000
  })
  try {
    await transport.verify()
  } finally {
    transport.close()
  }
}

export async function inspectAccountHealth(account: StoredAccount): Promise<AccountHealth> {
  const [imap, smtp] = await Promise.allSettled([testImap(account), testSmtp(account)])
  return {
    accountId: account.id,
    imap: imap.status === 'fulfilled'
      ? { ok: true, message: '收件连接正常' }
      : { ok: false, message: '收件连接失败' },
    smtp: smtp.status === 'fulfilled'
      ? { ok: true, message: '发件连接正常' }
      : { ok: false, message: '发件连接失败' },
    checkedAt: new Date().toISOString()
  }
}

export async function testAccount(account: StoredAccount): Promise<AccountHealth> {
  const health = await inspectAccountHealth(account)
  if (!health.imap.ok || !health.smtp.ok) {
    throw new Error('连接失败，请检查 IMAP/SMTP 是否开启及授权码是否正确')
  }
  return health
}

function summaryOf(account: StoredAccount, folder: string, message: FetchMessageObject): MailSummary {
  const sender = message.envelope?.from?.[0]
  const date = new Date(message.envelope?.date || message.internalDate || new Date())
  return {
    uid: message.uid,
    accountId: account.id,
    folder,
    from: sender?.name ? `${sender.name} <${sender.address || ''}>` : sender?.address || '未知发件人',
    subject: message.envelope?.subject || '（无主题）',
    date: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    unread: !message.flags?.has('\\Seen')
  }
}

function downloadableAttachmentParts(attachments: ParsedAttachment[]): ParsedAttachment[] {
  return attachments.filter((attachment) => attachment.contentDisposition === 'attachment' || !attachment.contentId)
}

function attachmentMetadata(attachments: ParsedAttachment[]): MailAttachment[] {
  const parts = downloadableAttachmentParts(attachments)
  const total = parts.reduce((sum, attachment) => sum + attachment.content.length, 0)
  return parts.map((attachment, index) => {
    const size = attachment.content.length
    const reason = attachmentDownloadReason(size, total)
    return {
      id: `attachment-${index + 1}`,
      name: sanitizeAttachmentFilename(attachment.filename || '未命名附件'),
      contentType: attachment.contentType || 'application/octet-stream',
      size,
      downloadable: !reason,
      ...(reason ? { reason } : {})
    }
  })
}

function folderId(path: string): string {
  return Buffer.from(path, 'utf8').toString('base64url')
}

function folderView(folder: FolderListing): MailFolder {
  const flags = folder.flags || new Set<string>()
  const normalizedFlags = new Set([...flags].map((flag) => flag.toLowerCase()))
  return {
    id: folderId(folder.path), path: folder.path, name: folder.name,
    ...(typeof folder.specialUse === 'string' ? { specialUse: folder.specialUse } : {}),
    selectable: !normalizedFlags.has('\\noselect'), readOnly: normalizedFlags.has('\\readonly')
  }
}

export async function listMailFolders(account: StoredAccount): Promise<MailFolder[]> {
  return withImap(account, async (client) => {
    const folders = await client.list() as unknown as FolderListing[]
    const priority = (folder: FolderListing): number => {
      const role = typeof folder.specialUse === 'string' ? folder.specialUse.toLowerCase() : ''
      return role === '\\inbox' || folder.path.toUpperCase() === 'INBOX' ? 0 :
        role === '\\sent' ? 1 : role === '\\drafts' ? 2 : role === '\\archive' ? 3 :
          role === '\\junk' ? 4 : role === '\\trash' ? 5 : 6
    }
    return folders.map(folderView).sort((left, right) => {
      const byRole = priority(left) - priority(right)
      return byRole || left.name.localeCompare(right.name, 'zh-CN')
    })
  })
}

function normalizedQuery(query: MailSearchQuery | undefined): MailSearchQuery {
  if (!query) return {}
  const clean = {
    ...(query.subject?.trim() ? { subject: query.subject.trim() } : {}),
    ...(query.from?.trim() ? { from: query.from.trim() } : {}),
    ...(query.since ? { since: query.since } : {}),
    ...(query.before ? { before: query.before } : {}),
    ...(query.unread === undefined ? {} : { unread: query.unread })
  }
  if (clean.since && clean.before && clean.before <= clean.since) throw new Error('结束日期必须晚于开始日期')
  return clean
}

function cursorText(cursor: MailCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function parseCursor(raw: string, folder: string, uidValidity: string, queryKey: string): MailCursor {
  let cursor: MailCursor
  try { cursor = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as MailCursor } catch {
    throw new Error('邮件分页游标无效，请刷新列表')
  }
  if (cursor.version !== 1 || cursor.folder !== folder || cursor.uidValidity !== uidValidity ||
    cursor.queryKey !== queryKey || !Number.isSafeInteger(cursor.beforeUid) || cursor.beforeUid < 1 ||
    (cursor.remaining !== undefined && (!Number.isSafeInteger(cursor.remaining) || cursor.remaining < 1)) ||
    typeof cursor.truncated !== 'boolean') throw new Error('邮件分页游标已失效，请刷新列表')
  return cursor
}

function searchCriteria(query: MailSearchQuery): Record<string, unknown> {
  const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`)
  return {
    ...(query.subject ? { subject: query.subject } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.since ? { since: date(query.since) } : {}),
    ...(query.before ? { before: date(query.before) } : {}),
    ...(query.unread === undefined ? {} : { seen: !query.unread }),
    ...(!Object.keys(query).length ? { all: true } : {})
  }
}

interface ListPageResult {
  page: MailPage
  state: MailboxSnapshot
}

function mailboxSnapshot(client: ImapFlow): MailboxSnapshot {
  const mailbox = client.mailbox
  if (!mailbox) throw new Error('邮箱文件夹缺少 UIDVALIDITY')
  return {
    uidValidity: mailbox.uidValidity.toString(),
    uidNext: mailbox.uidNext,
    messages: mailbox.exists,
    ...(mailbox.highestModseq === undefined ? {} : { modseq: mailbox.highestModseq.toString() })
  }
}

async function readListPage(client: ImapFlow, account: StoredAccount, folder: string,
  options: MailListOptions): Promise<ListPageResult> {
  const lock = await client.getMailboxLock(folder, { readOnly: true })
  try {
    const state = mailboxSnapshot(client)
    if (!state.uidValidity) throw new Error('邮箱文件夹缺少 UIDVALIDITY')
    const { uidValidity } = state
    const query = normalizedQuery(options.query)
    const queryKey = JSON.stringify(query)
    const cursor = options.cursor ? parseCursor(options.cursor, folder, uidValidity, queryKey) : undefined
    const found = await client.search(searchCriteria(query) as Parameters<ImapFlow['search']>[0], { uid: true })
    if (!Array.isArray(found) || !found.length) return { page: { messages: [], truncated: false, warnings: [] }, state }
    const descending = [...new Set(found)].sort((left, right) => right - left)
    const available = descending.filter((uid) => !cursor || uid < cursor.beforeUid)
    const searching = Object.keys(query).length > 0
    const limit = Math.min(MAIL_PAGE_SIZE, options.limit || MAIL_PAGE_SIZE)
    const budget = cursor?.remaining ?? (searching ? MAX_SEARCH_RESULTS : undefined)
    const pageSize = Math.min(limit, budget ?? limit)
    const selected = available.slice(0, pageSize)
    if (!selected.length) return { page: { messages: [], truncated: cursor?.truncated || false, warnings: [] }, state }
    const fetched = await client.fetchAll(selected, {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true
    }, { uid: true })
    const byUid = new Map(fetched.map((message) => [message.uid, summaryOf(account, folder, message)]))
    const messages = selected.flatMap((uid) => byUid.get(uid) ? [byUid.get(uid)!] : [])
    const remaining = budget === undefined ? undefined : budget - selected.length
    const truncated = cursor?.truncated || (searching && descending.length > MAX_SEARCH_RESULTS)
    const hasMore = available.length > selected.length && (remaining === undefined || remaining > 0)
    const nextCursor = hasMore ? cursorText({
      version: 1, folder, uidValidity, beforeUid: selected[selected.length - 1], queryKey,
      ...(remaining === undefined ? {} : { remaining }), truncated
    }) : undefined
    const warnings = fetched.length === selected.length ? [] : ['部分邮件在加载期间被移动或删除，请刷新确认最新列表']
    return { page: { messages, ...(nextCursor ? { nextCursor } : {}), truncated, warnings }, state }
  } finally {
    lock.release()
  }
}

export async function listMail(account: StoredAccount, folder: string, options: MailListOptions = {}): Promise<MailPage> {
  return withImap(account, async (client) => (await readListPage(client, account, folder, options)).page)
}

function cacheQueryKey(query: MailSearchQuery, limit: number): string {
  return JSON.stringify({ query, limit })
}

async function statusSnapshot(client: ImapFlow, folder: string): Promise<MailboxSnapshot | undefined> {
  try {
    const status = await client.status(folder, {
      uidValidity: true, uidNext: true, messages: true, highestModseq: true
    })
    if (!status || status.uidValidity === undefined || status.uidNext === undefined || status.messages === undefined) {
      return undefined
    }
    return {
      uidValidity: status.uidValidity.toString(),
      uidNext: status.uidNext,
      messages: status.messages,
      ...(status.highestModseq === undefined ? {} : { modseq: status.highestModseq.toString() })
    }
  } catch {
    return undefined
  }
}

/**
 * 判断服务器端的文件夹状态是否与快照一致。服务器支持 CONDSTORE 时用 HIGHESTMODSEQ 判等，
 * 否则退回「UIDNEXT + 邮件数」判等——两者都没变说明没有新邮件、也没有邮件被移走。
 */
function mailboxUnchanged(cached: MailboxSnapshot, current: MailboxSnapshot): boolean {
  if (cached.uidValidity !== current.uidValidity) return false
  if (cached.modseq !== undefined && current.modseq !== undefined) return cached.modseq === current.modseq
  return cached.uidNext === current.uidNext && cached.messages === current.messages
}

/** 只补拉新到的 UID，拼到快照第一页前面，避免为新邮件重读整页。 */
async function extendFirstPage(client: ImapFlow, account: StoredAccount, folder: string, cached: MailListEntry,
  limit: number): Promise<ListPageResult | undefined> {
  const lock = await client.getMailboxLock(folder, { readOnly: true })
  try {
    const state = mailboxSnapshot(client)
    if (state.uidValidity !== cached.state.uidValidity || state.uidNext <= cached.state.uidNext ||
      state.messages <= cached.state.messages || state.uidNext - cached.state.uidNext > limit) return undefined
    const uids: number[] = []
    for (let uid = cached.state.uidNext; uid < state.uidNext; uid++) uids.push(uid)
    const fetched = await client.fetchAll(uids, { uid: true, envelope: true, flags: true, internalDate: true }, { uid: true })
    const byUid = new Map(fetched.map((message) => [message.uid, summaryOf(account, folder, message)]))
    const fresh = uids.flatMap((uid) => byUid.get(uid) ? [byUid.get(uid)!] : [])
    if (!fresh.length) return undefined
    const seen = new Set<number>()
    const messages = [...fresh, ...cached.page.messages].filter((message) => {
      if (seen.has(message.uid)) return false
      seen.add(message.uid)
      return true
    }).slice(0, limit)
    const lastUid = messages[messages.length - 1]?.uid
    const hasMore = lastUid !== undefined && state.messages > messages.length
    const nextCursor = hasMore ? cursorText({
      version: 1, folder, uidValidity: state.uidValidity, beforeUid: lastUid, queryKey: JSON.stringify({}), truncated: false
    }) : undefined
    return { page: { messages, ...(nextCursor ? { nextCursor } : {}), truncated: false, warnings: [] }, state }
  } finally {
    lock.release()
  }
}

/**
 * 带缓存的第一页列表：先 STATUS 比对快照，未变化直接返回；只有新邮件时增量合并；
 * 文件夹换了（UIDVALIDITY 变化）、邮件被移走或带查询条件时重读整页。
 * 翻页（cursor）请求不经过缓存，每次读取最新状态。
 */
export async function listMailCached(scope: string, account: StoredAccount, folder: string,
  options: MailListOptions = {}): Promise<MailPage> {
  if (options.cursor) return listMail(account, folder, options)
  const query = normalizedQuery(options.query)
  const limit = Math.min(MAIL_PAGE_SIZE, options.limit || MAIL_PAGE_SIZE)
  const queryKey = cacheQueryKey(query, limit)
  const cached = options.force ? undefined : mailListCache.get(scope, account.id, folder, queryKey)
  return withImap(account, async (client) => {
    if (cached) {
      const current = await statusSnapshot(client, folder)
      if (current && mailboxUnchanged(cached.state, current)) return cached.page
      if (current && !Object.keys(query).length) {
        const extended = await extendFirstPage(client, account, folder, cached, limit)
        if (extended) {
          mailListCache.set(scope, account.id, folder, queryKey, extended.state, extended.page)
          return extended.page
        }
      }
    }
    const { page, state } = await readListPage(client, account, folder, { ...options, cursor: undefined, limit })
    mailListCache.set(scope, account.id, folder, queryKey, state, page)
    return page
  })
}

export async function getMail(account: StoredAccount, folder: string, uid: number, markRead = true,
  includeRichBody = true, expectedUidValidity?: string): Promise<MailDetail> {
  if (!Number.isSafeInteger(uid) || uid < 1) throw new Error('邮件编号无效')
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder)
    try {
      return await readMailFromOpenMailbox(client, account, folder, uid, {
        markRead, includeRichBody, expectedUidValidity, maxBytes: MAX_INTERACTIVE_MAIL_BYTES
      })
    } finally {
      lock.release()
    }
  })
}

async function readMailFromOpenMailbox(client: ImapFlow, account: StoredAccount, folder: string, uid: number, options: {
  markRead: boolean
  includeRichBody: boolean
  expectedUidValidity?: string
  maxBytes: number
  metadata?: FetchMessageObject
}): Promise<MailDetail> {
  const uidValidity = client.mailbox && client.mailbox.uidValidity.toString()
  if (!uidValidity) throw new Error('邮箱文件夹缺少 UIDVALIDITY')
  if (options.expectedUidValidity && uidValidity !== options.expectedUidValidity) {
    throw new Error('原邮件所在文件夹已变化，请重新检索')
  }
  const metadata = options.metadata || await client.fetchOne(uid, {
    uid: true, envelope: true, flags: true, internalDate: true, size: true
  }, { uid: true })
  if (!metadata) throw new Error('邮件不存在或已被移走')
  if ((metadata.size || 0) > options.maxBytes) {
    throw new Error(`邮件超过 ${Math.floor(options.maxBytes / 1_000_000)} MB，未读取正文`)
  }
  const source = await client.fetchOne(uid, { source: true }, { uid: true })
  if (!source || !source.source) throw new Error('邮件不存在或已被移走')
  const parsed = await simpleParser(source.source)
  let inlineBytes = 0
  const inlineImages = options.includeRichBody ? parsed.attachments.flatMap((attachment) => {
    const contentId = attachment.contentId?.replace(/^<|>$/g, '')
    if (!contentId || !/^image\/(?:png|jpeg|gif|webp)$/i.test(attachment.contentType) ||
      attachment.content.length > 2_000_000 || inlineBytes + attachment.content.length > 8_000_000) return []
    inlineBytes += attachment.content.length
    return [{ contentId, contentType: attachment.contentType.toLowerCase(), base64: attachment.content.toString('base64') }]
  }) : []
  if (options.markRead) await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true })
  const summary = summaryOf(account, folder, metadata)
  return {
    ...summary,
    uidValidity,
    unread: options.markRead ? false : summary.unread,
    to: Array.isArray(parsed.to) ? parsed.to.map((address) => address.text).join(', ') : parsed.to?.text || '',
    text: parsed.text || '（这封邮件没有纯文本正文）',
    html: options.includeRichBody && typeof parsed.html === 'string' ? parsed.html : undefined,
    inlineImages,
    messageId: parsed.messageId,
    references: parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : undefined,
    attachments: attachmentMetadata(parsed.attachments)
  }
}

export async function getMailAttachment(account: StoredAccount, folder: string, uid: number,
  expectedUidValidity: string, attachmentId: string): Promise<AttachmentDownload> {
  if (!/^attachment-[1-9]\d*$/.test(attachmentId)) throw new Error('附件编号无效')
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder, { readOnly: true })
    try {
      const uidValidity = client.mailbox && client.mailbox.uidValidity.toString()
      if (!uidValidity || uidValidity !== expectedUidValidity) throw new Error('邮件所在文件夹已变化，请重新打开邮件')
      const metadata = await client.fetchOne(uid, { uid: true, size: true }, { uid: true })
      if (!metadata) throw new Error('邮件不存在或已被移走')
      if ((metadata.size || 0) > MAX_INTERACTIVE_MAIL_BYTES) throw new Error('邮件过大，无法安全下载附件')
      const source = await client.fetchOne(uid, { source: true }, { uid: true })
      if (!source || !source.source) throw new Error('邮件不存在或已被移走')
      const parsed = await simpleParser(source.source)
      const parts = downloadableAttachmentParts(parsed.attachments)
      const details = attachmentMetadata(parsed.attachments)
      const index = Number(attachmentId.slice('attachment-'.length)) - 1
      const detail = details[index]
      const attachment = parts[index]
      if (!detail || !attachment) throw new Error('附件不存在，请重新打开邮件')
      if (!detail.downloadable) throw new Error(detail.reason || '附件超过安全下载限制')
      return {
        fileName: detail.name,
        contentType: detail.contentType,
        size: detail.size,
        base64: attachment.content.toString('base64')
      }
    } finally {
      lock.release()
    }
  })
}

export async function getSentFolder(account: StoredAccount): Promise<string | null> {
  return withImap(account, async (client) => {
    const folders = await client.list()
    return folders.find((folder) => folder.specialUse === '\\Sent')?.path ||
      folders.find((folder) => /^(sent|已发送|已发邮件)/i.test(folder.name))?.path || null
  })
}

export async function sendMail(account: StoredAccount, draft: MailDraft): Promise<void> {
  const recipients = validateRecipients(draft)
  if (!draft.subject.trim()) throw new Error('请输入邮件主题')
  if (!draft.text.trim()) throw new Error('请输入邮件正文')

  let inReplyTo: string | undefined
  let references: string[] | undefined
  if (draft.replyTo) {
    const original = await getMail(account, draft.replyTo.folder, draft.replyTo.uid, false, false,
      draft.replyTo.uidValidity)
    inReplyTo = original.messageId
    references = [...(original.references || []), ...(original.messageId ? [original.messageId] : [])]
  }

  const transport = nodemailer.createTransport({
    host: PROVIDERS[account.provider].smtp,
    port: 465,
    secure: true,
    auth: { user: account.address, pass: account.authorizationCode },
    connectionTimeout: 15_000
  })
  try {
    await transport.sendMail({
      from: account.address,
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: draft.subject.trim(),
      text: draft.text.trim(),
      inReplyTo,
      references
    })
  } finally {
    transport.close()
  }
}

export async function todayMail(account: StoredAccount, start: Date): Promise<{ messages: MailDetail[]; warnings: string[] }> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true })
    try {
      const found = await client.search({ since: start }, { uid: true })
      if (!found || !Array.isArray(found) || found.length === 0) return { messages: [], warnings: [] }
      const uids = found.slice(-30)
      const metadata = await client.fetchAll(uids.join(','), {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true
      }, { uid: true })
      const selected = metadata.filter((message) => new Date(summaryOf(account, 'INBOX', message).date) >= start)
      const messages: MailDetail[] = []
      const warnings: string[] = []
      for (const message of selected) {
        try {
          messages.push(await readMailFromOpenMailbox(client, account, 'INBOX', message.uid, {
            markRead: false, includeRichBody: false, maxBytes: MAX_AI_MAIL_BYTES, metadata: message
          }))
        } catch (error) {
          const subject = summaryOf(account, 'INBOX', message).subject
          warnings.push(`${account.address} · ${subject}：${error instanceof Error ? error.message : '读取失败'}`)
        }
      }
      return { messages, warnings }
    } finally {
      lock.release()
    }
  })
}

export interface AgentSearchFilters {
  since: Date
  before?: Date
  from?: string
  subject?: string
  text?: string
  unread?: boolean
}

export async function searchAgentMail(account: StoredAccount, filters: AgentSearchFilters): Promise<{
  matches: AgentMailRef[]; searchedFolders: string[]; truncated: boolean; warnings: string[]
  counts: { inbox: number; sent: number }
}> {
  return withImap(account, async (client) => {
    const folders = await client.list()
    const sent = folders.find((item) => item.specialUse === '\\Sent')?.path ||
      folders.find((item) => /^(sent|已发送|已发邮件)/i.test(item.name))?.path
    const paths = ['INBOX', ...(sent ? [sent] : [])]
    const archiveAvailable = folders.some((item) => item.specialUse === '\\Archive')
    const matches: AgentMailRef[] = []
    const searchedFolders: string[] = []
    const warnings = sent ? [] : [`${account.address} 未找到已发送文件夹`]
    const counts = { inbox: 0, sent: 0 }
    let truncated = false
    for (const path of paths) {
      try {
        const lock = await client.getMailboxLock(path, { readOnly: true })
        try {
          const uidValidity = client.mailbox && client.mailbox.uidValidity.toString()
          if (!uidValidity) throw new Error('邮箱文件夹缺少 UIDVALIDITY')
          const query = {
            since: filters.since,
            ...(filters.before ? { before: filters.before } : {}),
            ...(filters.from ? { from: filters.from } : {}),
            ...(filters.subject ? { subject: filters.subject } : {}),
            ...(filters.text ? { text: filters.text } : {}),
            ...(filters.unread === undefined ? {} : { seen: !filters.unread })
          }
          const found = await client.search(query, { uid: true })
          if (!Array.isArray(found) || found.length === 0) {
            searchedFolders.push(path)
            continue
          }
          counts[path === 'INBOX' ? 'inbox' : 'sent'] += found.length
          const selected = [...found].sort((a, b) => b - a).slice(0, 100)
          if (found.length > selected.length) truncated = true
          const messages = await client.fetchAll(selected, {
            uid: true, envelope: true, flags: true, internalDate: true
          }, { uid: true })
          matches.push(...messages.map((message) => ({
            ...summaryOf(account, path, message), accountAddress: account.address, uidValidity, archiveAvailable,
            to: message.envelope?.to?.flatMap((recipient) => recipient.address ? [recipient.address] : []) || []
          })))
          searchedFolders.push(path)
        } finally {
          lock.release()
        }
      } catch {
        warnings.push(`${account.address} 的 ${path} 检索失败`)
      }
    }
    return { matches, searchedFolders, truncated, warnings, counts }
  })
}

export async function readAgentMailBatch(account: StoredAccount, refs: AgentMailRef[]): Promise<Array<{
  mail: AgentMailRef; text?: string; error?: string
}>> {
  if (refs.some((ref) => ref.accountId !== account.id || !Number.isSafeInteger(ref.uid) || ref.uid < 1)) {
    throw new Error('邮件引用无效')
  }
  return withImap(account, async (client) => {
    const results: Array<{ mail: AgentMailRef; text?: string; error?: string }> = []
    for (const folder of [...new Set(refs.map((ref) => ref.folder))]) {
      const group = refs.filter((ref) => ref.folder === folder)
      try {
        const lock = await client.getMailboxLock(folder, { readOnly: true })
        try {
          for (const mail of group) {
            try {
              if (!client.mailbox || client.mailbox.uidValidity.toString() !== mail.uidValidity) throw new Error('邮箱文件夹已变化')
              const header = await client.fetchOne(mail.uid, { uid: true, size: true }, { uid: true })
              if (!header) throw new Error('邮件已被移走')
              if ((header.size || 0) > 5_000_000) {
                results.push({ mail, text: '（邮件超过 5 MB，未读取正文）' })
                continue
              }
              const message = await client.fetchOne(mail.uid, { source: true }, { uid: true })
              if (!message || !message.source) throw new Error('邮件已被移走')
              const parsed = await simpleParser(message.source)
              results.push({ mail, text: (parsed.text || '').slice(0, 1500) || '（无可读取的纯文本正文）' })
            } catch (error) {
              results.push({ mail, error: error instanceof Error ? error.message : '读取失败' })
            }
          }
        } finally {
          lock.release()
        }
      } catch {
        results.push(...group.map((mail) => ({ mail, error: '文件夹无法读取' })))
      }
    }
    return results
  })
}

export async function executeAgentAction(account: StoredAccount, action: AgentAction): Promise<void> {
  const { mail, kind } = action
  if (mail.accountId !== account.id || !Number.isSafeInteger(mail.uid) || mail.uid < 1) throw new Error('邮件引用无效')
  return withImap(account, async (client) => {
    let archive: string | undefined
    if (kind === 'archive') {
      if (mail.folder.toUpperCase() !== 'INBOX') throw new Error('仅可归档收件箱邮件')
      const folders = await client.list()
      archive = folders.find((item) => item.specialUse === '\\Archive')?.path
      if (!archive) throw new Error('该邮箱没有可用的归档文件夹')
    }
    const lock = await client.getMailboxLock(mail.folder)
    try {
      if (!client.mailbox || client.mailbox.uidValidity.toString() !== mail.uidValidity) throw new Error('邮箱文件夹已变化，请重新检索')
      const current = await client.fetchOne(mail.uid, { uid: true }, { uid: true })
      if (!current) throw new Error('邮件已被移走')
      const uid = String(mail.uid)
      if (kind === 'markRead') {
        if (!await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })) throw new Error('标记已读失败')
      } else if (kind === 'markUnread') {
        if (!await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true })) throw new Error('标记未读失败')
      } else if (kind === 'archive' && archive) {
        if (!await client.messageMove(uid, archive, { uid: true })) throw new Error('归档失败')
      } else {
        throw new Error('不支持的整理操作')
      }
    } finally {
      lock.release()
    }
  })
}
