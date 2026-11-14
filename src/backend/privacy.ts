const SENSITIVE_MAIL = /(验证码|校验码|动态码|动态密码|一次性(密码|口令)|重置密码|密码重置|登录验证|verification\s*code|verify\s*code|one[-\s]?time\s*(code|password)|2fa|two[-\s]?factor|otp|password\s*reset|security\s*code|银行|信用卡|借记卡|账单|发票|身份证|护照|card\s*ending|account\s*number|routing\s*number)/i

export function isSensitiveMail(subject: string, text = ''): boolean {
  return SENSITIVE_MAIL.test(subject) || SENSITIVE_MAIL.test(text.slice(0, 2000))
}

export function splitSensitiveMails<T extends { subject: string; text?: string }>(mails: T[]): { kept: T[]; skipped: number } {
  const kept: T[] = []
  let skipped = 0
  for (const mail of mails) {
    if (isSensitiveMail(mail.subject, mail.text || '')) skipped += 1
    else kept.push(mail)
  }
  return { kept, skipped }
}
