import type { SensitiveAction, SensitiveCategory, SensitivePolicy } from '../shared/models'
import { DEFAULT_SENSITIVE_POLICY } from '../shared/models'

const RULES: Record<SensitiveCategory, RegExp> = {
  code: /(验证码|校验码|动态码|动态密码|一次性(?:密码|口令)|登录验证|验证身份|verification\s*code|verify\s*code|one[-\s]?time\s*(?:code|password)|2fa|two[-\s]?factor|otp|security\s*code|password\s*reset|重置密码|密码重置)/i,
  finance: /(银行|信用卡|借记卡|账单|发票|card\s*ending|account\s*number|routing\s*number)/i,
  identity: /(身份证|护照|passport|id\s*card)/i
}

const MASK = '[已隐藏]'

/** 返回命中的敏感类别；正文只看前 2000 字，避免长邮件误判。 */
export function sensitiveCategories(subject: string, text = ''): SensitiveCategory[] {
  const body = text.slice(0, 2000)
  return (Object.keys(RULES) as SensitiveCategory[]).filter((key) => RULES[key].test(subject) || RULES[key].test(body))
}

export function isSensitiveMail(subject: string, text = ''): boolean {
  return sensitiveCategories(subject, text).length > 0
}

/** 多个类别命中时，只要有一类要求拦截就拦截；否则有一类要求脱敏就脱敏。 */
export function actionFor(policy: Partial<SensitivePolicy> | undefined, categories: SensitiveCategory[]): SensitiveAction {
  const merged = { ...DEFAULT_SENSITIVE_POLICY, ...(policy || {}) }
  if (categories.some((key) => merged[key] === 'block')) return 'block'
  if (categories.some((key) => merged[key] === 'mask')) return 'mask'
  return 'allow'
}

export function maskSensitiveText(subject: string, text: string, categories: SensitiveCategory[]): { subject: string; text: string } {
  const mask = (value: string): string => {
    let result = value
    if (categories.includes('finance')) {
      result = result.replace(/\b(?:\d[ -]?){12,19}\b/g, (match) => `${MASK} ${match.replace(/\D/g, '').slice(-4)}`)
    }
    if (categories.includes('identity')) {
      result = result.replace(/\b\d{17}[\dXx]\b|\b\d{15}\b/g, MASK)
      result = result.replace(/(护照|passport|身份证|id\s*card)([^\n]{0,12}?)([A-Za-z]?\d{6,18})/gi,
        (_match, label: string, gap: string) => `${label}${gap}${MASK}`)
    }
    if (categories.includes('code')) {
      result = result.replace(/(验证码|校验码|动态码|动态密码|一次性(?:密码|口令)|verification\s*code|verify\s*code|one[-\s]?time\s*(?:code|password)|security\s*code|otp|2fa)(\s*(?:是|为|is)?\s*[:：]?\s*)([A-Za-z0-9]{4,12})/gi,
        (_match, label: string) => `${label}${MASK}`)
      result = result.replace(/\b\d{6}\b/g, MASK)
    }
    return result
  }
  return { subject: mask(subject), text: mask(text) }
}

export interface PrivacyDecision {
  action: SensitiveAction
  categories: SensitiveCategory[]
  subject: string
  text: string
}

export function applyPrivacy(policy: Partial<SensitivePolicy> | undefined, subject: string, text = ''): PrivacyDecision {
  const categories = sensitiveCategories(subject, text)
  const action = actionFor(policy, categories)
  if (action !== 'mask') return { action, categories, subject, text }
  const masked = maskSensitiveText(subject, text, categories)
  return { action, categories, subject: masked.subject, text: masked.text }
}
