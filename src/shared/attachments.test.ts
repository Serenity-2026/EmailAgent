import { describe, expect, it } from 'vitest'
import {
  attachmentDownloadReason, MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES, sanitizeAttachmentFilename
} from './attachments'

describe('safe attachment boundaries', () => {
  it('strips paths, control characters and reserved device names while preserving a short extension', () => {
    expect(sanitizeAttachmentFilename('../../CON.txt')).toBe('_CON.txt')
    expect(sanitizeAttachmentFilename('..\\课程\u0000报告?.pdf')).toBe('课程_报告_.pdf')
    expect(sanitizeAttachmentFilename(' . ')).toBe('attachment')
    expect(sanitizeAttachmentFilename(`${'a'.repeat(140)}.pdf`)).toHaveLength(120)
    expect(sanitizeAttachmentFilename(`${'a'.repeat(140)}.pdf`)).toMatch(/\.pdf$/)
  })

  it('enforces both individual and aggregate decoded-byte limits', () => {
    expect(attachmentDownloadReason(MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES)).toBeUndefined()
    expect(attachmentDownloadReason(MAX_ATTACHMENT_BYTES + 1, MAX_ATTACHMENT_BYTES + 1)).toContain('单个附件')
    expect(attachmentDownloadReason(8_000_000, MAX_TOTAL_ATTACHMENT_BYTES + 1)).toContain('合计')
    expect(attachmentDownloadReason(-1, 0)).toContain('无效')
  })
})
