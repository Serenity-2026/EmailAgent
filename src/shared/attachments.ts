export const MAX_ATTACHMENT_BYTES = 10_000_000
export const MAX_TOTAL_ATTACHMENT_BYTES = 20_000_000

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function attachmentDownloadReason(size: number, total: number): string | undefined {
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(total) || total < size) return '附件大小无效'
  if (size > MAX_ATTACHMENT_BYTES) return `单个附件超过 ${MAX_ATTACHMENT_BYTES / 1_000_000} MB`
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) return `本邮件附件合计超过 ${MAX_TOTAL_ATTACHMENT_BYTES / 1_000_000} MB`
  return undefined
}

export function sanitizeAttachmentFilename(value: string): string {
  const leaf = value.replace(/\\/g, '/').split('/').pop() || ''
  let name = leaf.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').trim()
  if (!name || name === '.' || name === '..') name = 'attachment'
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`
  if (name.length > 120) {
    const dot = name.lastIndexOf('.')
    const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : ''
    name = `${name.slice(0, 120 - extension.length)}${extension}`
  }
  return name
}
