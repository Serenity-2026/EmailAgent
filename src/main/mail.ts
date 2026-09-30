import { ImapFlow, type FetchMessageObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import type { MailDetail, MailDraft, MailSummary } from '../shared/models'
import { PROVIDERS, validateRecipient } from './providers'
import type { StoredAccount } from './store'

function clientFor(account: StoredAccount): ImapFlow {
  return new ImapFlow({
    host: PROVIDERS[account.provider].imap,
    port: 993,
    secure: true,
    auth: { user: account.address, pass: account.authorizationCode },
    connectionTimeout: 15_000,
    logger: false
  })
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

export async function getMail(account: StoredAccount, folder: string, uid: number, markRead = true): Promise<MailDetail> {
  if (!Number.isSafeInteger(uid) || uid < 1) throw new Error('邮件编号无效')
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder)
    try {
      const message = await client.fetchOne(uid, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        source: true
      }, { uid: true })
      if (!message || !message.source) throw new Error('邮件不存在或已被移走')
      const parsed = await simpleParser(message.source)
      if (markRead) await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true })
      const summary = summaryOf(account, folder, message)
      return {
        ...summary,
        unread: markRead ? false : summary.unread,
        to: Array.isArray(parsed.to) ? parsed.to.map((address) => address.text).join(', ') : parsed.to?.text || '',
        text: parsed.text || '（这封邮件没有纯文本正文）',
        messageId: parsed.messageId,
        references: parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : undefined,
        attachmentNames: parsed.attachments.map((attachment) => attachment.filename || '未命名附件')
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
  validateRecipient(draft.to)
  if (!draft.subject.trim()) throw new Error('请输入邮件主题')
  if (!draft.text.trim()) throw new Error('请输入邮件正文')

  let inReplyTo: string | undefined
  let references: string[] | undefined
  if (draft.replyTo) {
    const original = await getMail(account, draft.replyTo.folder, draft.replyTo.uid)
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

export async function todayMail(account: StoredAccount, start: Date): Promise<MailDetail[]> {
  const summaries = await withImap(account, async (client) => {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const found = await client.search({ since: start }, { uid: true })
      if (!found || !Array.isArray(found) || found.length === 0) return []
      const uids = found.slice(-30)
      const messages = await client.fetchAll(uids.join(','), {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true
      }, { uid: true })
      return messages.map((message) => summaryOf(account, 'INBOX', message))
        .filter((message) => new Date(message.date) >= start)
    } finally {
      lock.release()
    }
  })
  const details: MailDetail[] = []
  for (const summary of summaries) {
    details.push(await getMail(account, 'INBOX', summary.uid, false))
  }
  return details
}
