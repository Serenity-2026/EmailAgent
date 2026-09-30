import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAction, AgentMailRef } from '../shared/models'
import type { StoredAccount } from './store'

const state = vi.hoisted(() => ({
  uidValidity: 55n, archive: false, exists: true, calls: [] as string[], searchCount: 0, connectionError: false
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
    async list(): Promise<Array<{ path: string; name: string; specialUse: string }>> {
      return [
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
    async fetchOne(): Promise<false | { uid: number; size: number; source: Buffer }> {
      state.calls.push('fetchOne')
      return state.exists ? { uid: 7, size: 100, source: Buffer.from(
        'From: teacher@example.com\r\nSubject: Test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n周五提交报告。') } : false
    }
    async messageFlagsAdd(): Promise<boolean> { state.calls.push('markRead'); return true }
    async messageFlagsRemove(): Promise<boolean> { state.calls.push('markUnread'); return true }
    async messageMove(): Promise<boolean> { state.calls.push('archive'); return true }
    async search(): Promise<number[]> { return Array.from({ length: state.searchCount }, (_, index) => index + 1) }
    async fetchAll(uids: number[]): Promise<Array<Record<string, unknown>>> {
      state.calls.push(`fetchAll:${uids.length}`)
      return uids.map((uid) => ({ uid, envelope: { subject: `Mail ${uid}`, from: [{ address: 'teacher@example.com' }] },
        flags: new Set(), internalDate: new Date('2026-09-25T00:00:00.000Z') }))
    }
  }
}))

import { executeAgentAction, readAgentMailBatch, searchAgentMail } from './mail'

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
  state.calls = []
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

  it('moves a confirmed message only when an archive folder exists', async () => {
    state.archive = true
    await executeAgentAction(account, { kind: 'archive', mail })
    expect(state.calls).toContain('archive')
  })
})
