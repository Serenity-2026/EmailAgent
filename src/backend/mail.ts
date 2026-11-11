import { ImapFlow, type FetchMessageObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import type { AgentAction, AgentMailRef, MailDetail, MailDraft, MailSummary } from '../shared/models'
import { PROVIDERS, validateRecipient } from './providers'
import type { StoredAccount } from '../shared/vault'

export const MAX_INTERACTIVE_MAIL_BYTES = 20_000_000
export const MAX_AI_MAIL_BYTES = 5_000_000

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

export async function testAccount(account: StoredAccount): Promise<void> {
  await withImap(account, async () => undefined)
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

export async function listMail(account: StoredAccount, folder: string): Promise<MailSummary[]> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder)
    try {
      const count = client.mailbox && client.mailbox.exists
      if (!count) return []
      const first = Math.max(1, count - 49)
      const messages = await client.fetchAll(`${first}:*`, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true
      })
      return messages.map((message) => summaryOf(account, folder, message)).reverse()
    } finally {
      lock.release()
    }
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
    attachmentNames: parsed.attachments.filter((attachment) =>
      attachment.contentDisposition === 'attachment' || !attachment.contentId)
      .map((attachment) => attachment.filename || '未命名附件')
  }
}

export async function getSentFolder(account: StoredAccount): Promise<string | null> {
  return withImap(account, async (client) => {
    const folders = await client.list()
    return folders.find((folder) => folder.specialUse === '\\Sent')?.path ||
      folders.find((folder) => /^(sent|已发送|已发邮件)/i.test(folder.name))?.path || null
  })
}

export async function sendMail(account: StoredAccount, draft: MailDraft): Promise<void> {
  validateRecipient(draft.to)
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
      to: draft.to.trim(),
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
  unread?: boolean
}

export async function searchAgentMail(account: StoredAccount, filters: AgentSearchFilters): Promise<{
  matches: AgentMailRef[]; searchedFolders: string[]; truncated: boolean; warnings: string[]
}> {
  return withImap(account, async (client) => {
    const folders = await client.list()
    const sent = folders.find((item) => item.specialUse === '\\Sent')?.path ||
      folders.find((item) => /^(sent|已发送|已发邮件)/i.test(item.name))?.path
    const paths = ['INBOX', ...(sent ? [sent] : [])]
    const archiveAvailable = folders.some((item) => item.specialUse === '\\Archive' || /^(archive|归档)$/i.test(item.name))
    const matches: AgentMailRef[] = []
    const searchedFolders: string[] = []
    const warnings = sent ? [] : [`${account.address} 未找到已发送文件夹`]
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
            ...(filters.unread === undefined ? {} : { seen: !filters.unread })
          }
          const found = await client.search(query, { uid: true })
          if (!Array.isArray(found) || found.length === 0) {
            searchedFolders.push(path)
            continue
          }
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
    return { matches, searchedFolders, truncated, warnings }
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
      archive = folders.find((item) => item.specialUse === '\\Archive')?.path ||
        folders.find((item) => /^(archive|归档)$/i.test(item.name))?.path
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
