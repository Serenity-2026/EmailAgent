import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAction, AgentMailRef } from '../shared/models'
import type { StoredAccount } from '../shared/vault'

const state = vi.hoisted(() => ({
  uidValidity: 55n, archive: false, exists: true, calls: [] as string[], searchCount: 0,
  connectionError: false, smtpError: false,
  sourceSize: 100, missingSourceUids: new Set<number>(), missingMetadataUids: new Set<number>(),
  sentMessages: [] as Array<Record<string, unknown>>,
  searchQueries: [] as Array<Record<string, unknown>>,
  folders: [] as Array<{ path: string; name: string; specialUse?: string; flags?: Set<string> }>
}))

vi.mock('imapflow', () => ({
  ImapFlow: class {
    mailbox: { uidValidity: bigint } | false = false
    private errorListener?: (error: Error) => void
    on(event: string, listener: (error: Error) => void): this {
      if (event === 'error') this.errorListener = listener
      return this
    }
    async connect(): Promise<void> {
      state.calls.push('connect')
      if (state.connectionError) {
        if (!this.errorListener) throw new Error('Unhandled IMAP error event')
        this.errorListener(new Error('connection lost'))
        state.calls.push('error handled')
        throw new Error('connection lost')
      }
    }
    async logout(): Promise<void> { state.calls.push('logout') }
    async list(): Promise<Array<{ path: string; name: string; specialUse?: string; flags?: Set<string> }>> {
      return state.folders.length ? state.folders : [
        { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' },
        { path: 'Sent', name: 'Sent', specialUse: '\\Sent' },
        ...(state.archive ? [{ path: 'Archive', name: 'Archive', specialUse: '\\Archive' }] : [])
      ]
    }
    async getMailboxLock(path: string, options?: { readOnly?: boolean }): Promise<{ release: () => void }> {
      state.calls.push(`lock:${path}:${Boolean(options?.readOnly)}`)
      this.mailbox = { uidValidity: state.uidValidity }
      return { release: () => state.calls.push('release') }
    }
    async fetchOne(uid = 7, query: { source?: boolean } = {}): Promise<false | Record<string, unknown>> {
      state.calls.push(`fetchOne:${uid}:${query.source ? 'source' : 'metadata'}`)
      if (!state.exists || (query.source && state.missingSourceUids.has(uid))) return false
      const metadata = { uid, size: state.sourceSize,
        envelope: { subject: `Mail ${uid}`, from: [{ address: 'teacher@example.com' }] },
        flags: new Set(), internalDate: new Date('2026-09-25T00:00:00.000Z') }
      return query.source ? { uid, source: Buffer.from(
        'From: teacher@example.com\r\nSubject: Test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n周五提交报告。') } : metadata
    }
    async messageFlagsAdd(): Promise<boolean> { state.calls.push('markRead'); return true }
    async messageFlagsRemove(): Promise<boolean> { state.calls.push('markUnread'); return true }
    async messageMove(): Promise<boolean> { state.calls.push('archive'); return true }
    async search(query: Record<string, unknown>): Promise<number[]> {
      state.searchQueries.push(query)
      return Array.from({ length: state.searchCount }, (_, index) => index + 1)
    }
    async fetchAll(input: number[] | string): Promise<Array<Record<string, unknown>>> {
      const uids = typeof input === 'string' ? input.split(',').map(Number) : input
      state.calls.push(`fetchAll:${uids.length}`)
      return uids.filter((uid) => !state.missingMetadataUids.has(uid)).map((uid) => ({ uid, size: state.sourceSize,
        envelope: { subject: `Mail ${uid}`, from: [{ address: 'teacher@example.com' }] },
        flags: new Set(), internalDate: new Date('2026-09-25T00:00:00.000Z') }))
    }
  }
}))

vi.mock('nodemailer', () => ({ default: { createTransport: () => ({
  verify: async () => {
    state.calls.push('smtp verify')
    if (state.smtpError) throw new Error('SMTP secret provider detail')
  },
  sendMail: async (message: Record<string, unknown>) => { state.sentMessages.push(message) },
  close: () => state.calls.push('smtp close')
}) } }))

import {
  executeAgentAction, getMail, inspectAccountHealth, listMail, listMailFolders, MAX_INTERACTIVE_MAIL_BYTES,
  readAgentMailBatch, searchAgentMail, sendMail, testAccount, todayMail
} from './mail'

const account: StoredAccount = { id: 'one', provider: 'qq', address: 'student@qq.com', authorizationCode: 'example' }
const mail: AgentMailRef = {
  uid: 7, accountId: 'one', accountAddress: account.address, folder: 'INBOX', uidValidity: '55',
  from: 'teacher@example.com', subject: '报告', date: '2026-09-25T00:00:00.000Z', unread: true
}

beforeEach(() => {
  state.uidValidity = 55n
  state.archive = false
  state.exists = true
  state.searchCount = 0
  state.connectionError = false
  state.smtpError = false
  state.sourceSize = 100
  state.missingSourceUids = new Set()
  state.missingMetadataUids = new Set()
  state.searchQueries = []
  state.folders = []
  state.sentMessages = []
  state.calls = []
})

describe('account connectivity', () => {
  it('reports incoming and outgoing connections independently without returning provider details', async () => {
    state.connectionError = true
    const incomingFailure = await inspectAccountHealth(account)
    expect(incomingFailure).toMatchObject({
      accountId: account.id,
      imap: { ok: false, message: '收件连接失败' },
      smtp: { ok: true, message: '发件连接正常' }
    })
    expect(JSON.stringify(incomingFailure)).not.toContain(account.authorizationCode)

    state.connectionError = false
    state.smtpError = true
    const outgoingFailure = await inspectAccountHealth(account)
    expect(outgoingFailure).toMatchObject({ imap: { ok: true }, smtp: { ok: false, message: '发件连接失败' } })
    await expect(testAccount(account)).rejects.toThrow('连接失败')
    expect(state.calls).toContain('smtp close')
  })
})

describe('mail sending recipients', () => {
  it('validates each address and sends deduplicated to/cc/bcc arrays', async () => {
    await sendMail(account, {
      accountId: account.id, to: ['one@example.com', 'ONE@example.com'], cc: ['two@example.com'],
      bcc: ['hidden@example.com'], subject: '通知', text: '正文'
    })
    expect(state.sentMessages[0]).toMatchObject({
      to: ['one@example.com'], cc: ['two@example.com'], bcc: ['hidden@example.com']
    })
    await expect(sendMail(account, {
      accountId: account.id, to: ['one@example.com'], cc: ['张三'], bcc: [], subject: '通知', text: '正文'
    })).rejects.toThrow('有效的收件人')
    expect(state.sentMessages).toHaveLength(1)
  })
})

describe('mailbox navigation', () => {
  it('exposes provider folder roles and conservative capabilities with stable ids', async () => {
    state.folders = [
      { path: 'INBOX', name: '收件箱', specialUse: '\\Inbox' },
      { path: '其他文件夹/已发送', name: '已发送', specialUse: '\\Sent' },
      { path: '草稿', name: '草稿箱', specialUse: '\\Drafts' },
      { path: '垃圾邮件', name: '垃圾邮件', specialUse: '\\Junk' },
      { path: '归档', name: '归档', specialUse: '\\Archive', flags: new Set(['\\ReadOnly']) },
      { path: '容器', name: '容器', flags: new Set(['\\Noselect']) }
    ]
    const folders = await listMailFolders(account)
    expect(folders.map((item) => item.specialUse)).toEqual(['\\Inbox', '\\Sent', '\\Drafts', '\\Archive', '\\Junk', undefined])
    expect(folders.find((item) => item.path === '归档')).toMatchObject({ selectable: true, readOnly: true })
    expect(folders.find((item) => item.path === '容器')?.selectable).toBe(false)
    expect(new Set(folders.map((item) => item.id)).size).toBe(folders.length)
    state.folders = [
      { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' },
      { path: 'Sent Messages', name: '已发送邮件', specialUse: '\\Sent' },
      { path: 'Drafts', name: '草稿', specialUse: '\\Drafts' },
      { path: 'Junk', name: '垃圾邮件', specialUse: '\\Junk' },
      { path: 'Deleted Messages', name: '已删除', specialUse: '\\Trash' }
    ]
    const account163: StoredAccount = { ...account, provider: '163', address: 'student@163.com' }
    expect((await listMailFolders(account163)).map((item) => item.specialUse))
      .toEqual(['\\Inbox', '\\Sent', '\\Drafts', '\\Junk', '\\Trash'])
  })

  it('paginates by UID without duplicates when newer mail arrives', async () => {
    state.searchCount = 120
    const first = await listMail(account, 'INBOX')
    expect(first.messages).toHaveLength(50)
    expect(first.messages[0].uid).toBe(120)
    expect(first.messages.at(-1)?.uid).toBe(71)
    expect(first.nextCursor).toBeTruthy()
    state.searchCount = 121
    const second = await listMail(account, 'INBOX', { cursor: first.nextCursor })
    expect(second.messages[0].uid).toBe(70)
    expect(second.messages.at(-1)?.uid).toBe(21)
    expect(new Set([...first.messages, ...second.messages].map((item) => item.uid)).size).toBe(100)
    const third = await listMail(account, 'INBOX', { cursor: second.nextCursor })
    expect(third.messages.map((item) => item.uid)).toEqual(Array.from({ length: 20 }, (_, index) => 20 - index))
    expect(third.nextCursor).toBeUndefined()
  })

  it('executes bounded search on the IMAP server and reports truncation', async () => {
    state.searchCount = 250
    const page = await listMail(account, 'INBOX', { query: {
      subject: '课程', from: 'teacher@example.com', since: '2026-09-01', before: '2026-10-01', unread: true
    } })
    expect(page.messages).toHaveLength(50)
    expect(page.truncated).toBe(true)
    expect(page.nextCursor).toBeTruthy()
    expect(state.searchQueries[0]).toMatchObject({ subject: '课程', from: 'teacher@example.com', seen: false })
    expect(state.searchQueries[0].since).toBeInstanceOf(Date)
    let cursor = page.nextCursor
    let total = page.messages.length
    while (cursor) {
      const next = await listMail(account, 'INBOX', { cursor, query: {
        subject: '课程', from: 'teacher@example.com', since: '2026-09-01', before: '2026-10-01', unread: true
      } })
      total += next.messages.length
      cursor = next.nextCursor
    }
    expect(total).toBe(200)
  })

  it('warns instead of silently skipping mail moved during a page fetch', async () => {
    state.searchCount = 60
    state.missingMetadataUids.add(58)
    const page = await listMail(account, 'INBOX')
    expect(page.messages.some((item) => item.uid === 58)).toBe(false)
    expect(page.warnings[0]).toContain('移动或删除')
  })

  it('rejects a cursor after UIDVALIDITY changes', async () => {
    state.searchCount = 60
    const first = await listMail(account, 'INBOX')
    state.uidValidity = 56n
    await expect(listMail(account, 'INBOX', { cursor: first.nextCursor })).rejects.toThrow('游标已失效')
  })
})

describe('Agent IMAP access', () => {
  it('handles an IMAP error event while the connection request fails', async () => {
    state.connectionError = true
    await expect(searchAgentMail(account, { since: new Date('2026-07-01') })).rejects.toThrow('connection lost')
    expect(state.calls).toContain('error handled')
    expect(state.calls).toContain('logout')
  })
  it('reads mail without setting the Seen flag', async () => {
    const result = await readAgentMailBatch(account, [mail])
    expect(result[0].text).toContain('周五提交报告')
    expect(state.calls).toContain('lock:INBOX:true')
    expect(state.calls).not.toContain('markRead')
  })

  it('returns UIDVALIDITY for normal replies and rejects a stale reply identity', async () => {
    const detail = await getMail(account, 'INBOX', 7, false, false)
    expect(detail.uidValidity).toBe('55')
    state.uidValidity = 56n
    await expect(getMail(account, 'INBOX', 7, false, false, detail.uidValidity)).rejects.toThrow('文件夹已变化')
  })

  it('rejects oversized interactive MIME before reading its source or marking it seen', async () => {
    state.sourceSize = MAX_INTERACTIVE_MAIL_BYTES + 1
    await expect(getMail(account, 'INBOX', 7)).rejects.toThrow('超过 20 MB')
    expect(state.calls).not.toContain('fetchOne:7:source')
    expect(state.calls).not.toContain('markRead')
  })

  it('reads a daily batch through one connection and reports individual failures without marking mail seen', async () => {
    state.searchCount = 3
    state.missingSourceUids.add(2)
    const result = await todayMail(account, new Date('2026-09-24T00:00:00.000Z'))
    expect(result.messages.map((item) => item.uid)).toEqual([1, 3])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Mail 2')
    expect(state.calls.filter((call) => call === 'connect')).toHaveLength(1)
    expect(state.calls).toContain('lock:INBOX:true')
    expect(state.calls).not.toContain('markRead')
  })

  it('limits each searched folder to the latest 100 matching messages', async () => {
    state.searchCount = 101
    const result = await searchAgentMail(account, { since: new Date('2026-07-01') })
    expect(result.matches).toHaveLength(200)
    expect(result.truncated).toBe(true)
    expect(result.matches[0].uidValidity).toBe('55')
    expect(state.calls.filter((call) => call === 'fetchAll:100')).toHaveLength(2)
  })

  it('rejects stale UIDVALIDITY before changing a flag', async () => {
    state.uidValidity = 56n
    await expect(executeAgentAction(account, { kind: 'markRead', mail })).rejects.toThrow('文件夹已变化')
    expect(state.calls).not.toContain('markRead')
  })

  it('does not archive when the provider has no archive folder', async () => {
    const action: AgentAction = { kind: 'archive', mail }
    await expect(executeAgentAction(account, action)).rejects.toThrow('没有可用的归档文件夹')
    expect(state.calls).not.toContain('archive')
  })

  it('does not treat an Archive-like name as permission for a destructive move', async () => {
    state.folders = [
      { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' },
      { path: 'Archive', name: '归档' }
    ]
    await expect(executeAgentAction(account, { kind: 'archive', mail })).rejects.toThrow('没有可用的归档文件夹')
    expect(state.calls).not.toContain('archive')
  })

  it('moves a confirmed message only when an archive folder exists', async () => {
    state.archive = true
    await executeAgentAction(account, { kind: 'archive', mail })
    expect(state.calls).toContain('archive')
  })
})
