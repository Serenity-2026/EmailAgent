import type { MailPage } from '../shared/models'

export interface MailboxSnapshot {
  uidValidity: string
  uidNext: number
  messages: number
  modseq?: string
}

export interface MailListEntry {
  state: MailboxSnapshot
  page: MailPage
}

interface CacheEntry extends MailListEntry {
  scope: string
  accountId: string
  folder: string
  queryKey: string
}

const CACHE_LIMIT = 200

function entryKey(scope: string, accountId: string, folder: string, queryKey: string): string {
  return `${scope}\u0000${accountId}\u0000${folder}\u0000${queryKey}`
}

/**
 * 邮件列表快照缓存：以「登录用户 + 账户 + 文件夹 + 查询条件」为键，保留最近一次读取的第一页。
 * 只做进程内缓存，不落库；任何写操作通过 clearAccount 让对应账户的快照失效。
 */
class MailListCache {
  private entries = new Map<string, CacheEntry>()

  get(scope: string, accountId: string, folder: string, queryKey: string): MailListEntry | undefined {
    const key = entryKey(scope, accountId, folder, queryKey)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  set(scope: string, accountId: string, folder: string, queryKey: string, state: MailboxSnapshot, page: MailPage): void {
    const key = entryKey(scope, accountId, folder, queryKey)
    this.entries.delete(key)
    this.entries.set(key, { scope, accountId, folder, queryKey, state, page })
    while (this.entries.size > CACHE_LIMIT) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  /** 打开邮件后会把该邮件标记为已读，同步修正快照里的未读标记，避免下次命中缓存又显示未读。 */
  markSeen(scope: string, accountId: string, folder: string, uid: number): void {
    for (const entry of this.entries.values()) {
      if (entry.scope !== scope || entry.accountId !== accountId || entry.folder !== folder) continue
      if (!entry.page.messages.some((message) => message.uid === uid && message.unread)) continue
      entry.page = {
        ...entry.page,
        messages: entry.page.messages.map((message) =>
          message.uid === uid && message.unread ? { ...message, unread: false } : message)
      }
    }
  }

  clearAccount(scope: string, accountId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.scope === scope && entry.accountId === accountId) this.entries.delete(key)
    }
  }

  clearScope(scope: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.scope === scope) this.entries.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

export const mailListCache = new MailListCache()
