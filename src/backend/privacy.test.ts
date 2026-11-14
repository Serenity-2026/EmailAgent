import { describe, expect, it } from 'vitest'
import { actionFor, applyPrivacy, isSensitiveMail, maskSensitiveText, sensitiveCategories } from './privacy'

describe('sensitive mail policy', () => {
  it('categorizes verification codes, finance and identity mail', () => {
    expect(sensitiveCategories('登录验证码', '您的验证码是 123456')).toContain('code')
    expect(sensitiveCategories('信用卡账单', '本期应还 1200 元')).toContain('finance')
    expect(sensitiveCategories('护照续签', '护照号 E12345678')).toContain('identity')
    expect(isSensitiveMail('课程安排', '下周三交报告')).toBe(false)
  })

  it('blocks when any matched category requires blocking', () => {
    const policy = { code: 'block' as const, finance: 'allow' as const, identity: 'allow' as const }
    expect(actionFor(policy, ['code', 'finance'])).toBe('block')
    expect(actionFor(policy, ['finance'])).toBe('allow')
    expect(actionFor({ finance: 'mask' }, ['finance'])).toBe('mask')
  })

  it('masks codes, card numbers and identity numbers before sending', () => {
    const masked = maskSensitiveText('登录验证码', '您的验证码是 583921，卡号 6222 0202 0000 1234，护照号 E12345678。', ['code', 'finance', 'identity'])
    expect(masked.text).not.toContain('583921')
    expect(masked.text).toContain('[已隐藏]')
    expect(masked.text).toContain('1234')
    expect(masked.text).not.toContain('6222 0202')
    expect(masked.text).not.toContain('E12345678')
  })

  it('keeps content untouched when the policy allows the category', () => {
    const decision = applyPrivacy({ code: 'allow' }, '登录验证码', '您的验证码是 583921。')
    expect(decision.action).toBe('allow')
    expect(decision.text).toBe('您的验证码是 583921。')
  })
})
