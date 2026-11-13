import type { AccountInput, Provider } from '../shared/models'

export const PROVIDERS: Record<Provider, { domain: string; imap: string; smtp: string }> = {
  qq: { domain: 'qq.com', imap: 'imap.qq.com', smtp: 'smtp.qq.com' },
  '163': { domain: '163.com', imap: 'imap.163.com', smtp: 'smtp.163.com' }
}

export function validateAccount(input: AccountInput): void {
  const preset = PROVIDERS[input.provider]
  const address = input.address.trim()
  if (!preset) throw new Error('请选择支持的邮箱服务商')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('请输入有效的邮箱地址')
  if (!address.toLowerCase().endsWith(`@${preset.domain}`)) {
    throw new Error(`邮箱地址应以 @${preset.domain} 结尾`)
  }
  if (!input.authorizationCode.trim()) throw new Error('请输入邮箱客户端授权码')
}

export function validateRecipient(address: string): void {
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address.trim())) {
    throw new Error('请输入有效的收件人邮箱地址')
  }
}

export function validateRecipients(recipients: { to: string[]; cc: string[]; bcc: string[] }): {
  to: string[]; cc: string[]; bcc: string[]
} {
  if (![recipients.to, recipients.cc, recipients.bcc].every(Array.isArray)) throw new Error('收件人格式无效')
  const total = recipients.to.length + recipients.cc.length + recipients.bcc.length
  if (total === 0) throw new Error('请至少输入一位收件人')
  if (total > 50) throw new Error('一次最多填写 50 位收件人')
  const seen = new Set<string>()
  const clean = (items: string[]): string[] => items.map((address) => {
    validateRecipient(address)
    return address.trim()
  }).filter((address) => {
    const key = address.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { to: clean(recipients.to), cc: clean(recipients.cc), bcc: clean(recipients.bcc) }
}
