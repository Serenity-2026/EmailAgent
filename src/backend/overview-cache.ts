import type { MailOverview } from '../shared/models'

interface OverviewEntry {
  day: string
  accounts: string
  overview: MailOverview
}

const entries = new Map<string, OverviewEntry>()

function localDay(): string {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

function accountSignature(accounts: Array<{ id: string; address: string }>): string {
  return accounts.map((account) => `${account.id}:${account.address}`).sort().join('|')
}

export const overviewCache = {
  get(username: string, accounts: Array<{ id: string; address: string }>): MailOverview | undefined {
    const entry = entries.get(username)
    if (!entry || entry.day !== localDay() || entry.accounts !== accountSignature(accounts)) return undefined
    return entry.overview
  },
  set(username: string, accounts: Array<{ id: string; address: string }>, overview: MailOverview): void {
    entries.set(username, { day: localDay(), accounts: accountSignature(accounts), overview })
  },
  clear(username: string): void {
    entries.delete(username)
  },
  clearAll(): void {
    entries.clear()
  }
}
