// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { MailDetail } from '../../shared/models'
import { buildMailDocument } from './mail-html'

const mail = (html: string): MailDetail => ({
  uid: 1, accountId: 'account', folder: 'INBOX', from: 'sender@example.com', subject: 'HTML',
  date: new Date().toISOString(), unread: false, to: 'reader@example.com', text: 'fallback',
  attachments: [], inlineImages: [], uidValidity: '1', html
})

describe('HTML mail document', () => {
  it('keeps the message layout and inline styles', () => {
    const result = buildMailDocument(mail('<html><head><style>.title{color:#c00}</style></head><body><table><tr><td class="title">Hello</td></tr></table></body></html>'), false)
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('color:#c00')
    expect(result.html).toContain('Hello')
  })

  it('removes executable content and unsafe links', () => {
    const result = buildMailDocument(mail('<p onclick="alert(1)">Hello</p><script>alert(2)</script><iframe src="https://evil.example"></iframe><a href="javascript:alert(3)">click</a>'), false)
    expect(result.html).not.toContain('onclick=')
    expect(result.html).not.toContain('<script')
    expect(result.html).not.toContain('<iframe')
    expect(result.html).not.toContain('javascript:')
    expect(result.html).toContain("default-src 'none'")
  })

  it('shows CID images and blocks remote images until requested', () => {
    const message = mail('<img src="cid:logo@example.com"><img src="https://images.example.com/banner.png"><img src="http://images.example.com/unsafe.png">')
    message.inlineImages = [{ contentId: 'logo@example.com', contentType: 'image/png', base64: 'aGVsbG8=' }]
    const blocked = buildMailDocument(message, false)
    expect(blocked.html).toContain('data:image/png;base64,aGVsbG8=')
    expect(blocked.html).not.toContain('https://images.example.com/banner.png')
    expect(blocked.html).not.toContain('http://images.example.com/unsafe.png')
    expect(blocked.hasRemoteImages).toBe(true)
    const allowed = buildMailDocument(message, true)
    expect(allowed.html).toContain('https://images.example.com/banner.png')
    expect(allowed.html).not.toContain('http://images.example.com/unsafe.png')
  })
})
