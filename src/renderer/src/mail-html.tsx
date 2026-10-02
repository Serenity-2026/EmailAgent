import React, { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { Button } from 'antd'
import type { MailDetail } from '../../shared/models'

function cidKey(value: string): string {
  try {
    return decodeURIComponent(value).replace(/^<|>$/g, '').toLowerCase()
  } catch {
    return value.replace(/^<|>$/g, '').toLowerCase()
  }
}

export function buildMailDocument(detail: MailDetail, showRemoteImages: boolean): { html: string; hasRemoteImages: boolean } {
  const clean = DOMPurify.sanitize(detail.html || '', {
    WHOLE_DOCUMENT: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['form', 'input', 'button', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'picture', 'link', 'base', 'meta'],
    FORBID_ATTR: ['srcset', 'formaction', 'ping'],
    SANITIZE_NAMED_PROPS: true
  })
  const mailDocument = new DOMParser().parseFromString(clean, 'text/html')
  const inlineImages = new Map(detail.inlineImages.map((image) => [cidKey(image.contentId), image]))
  let hasRemoteImages = false

  for (const image of Array.from(mailDocument.querySelectorAll('img'))) {
    const source = image.getAttribute('src')?.trim() || ''
    if (/^cid:/i.test(source)) {
      const inline = inlineImages.get(cidKey(source.slice(4)))
      if (inline) image.setAttribute('src', `data:${inline.contentType};base64,${inline.base64}`)
      else image.removeAttribute('src')
    } else if (/^(?:https:)?\/\//i.test(source)) {
      hasRemoteImages = true
      if (showRemoteImages) image.setAttribute('src', source.startsWith('//') ? `https:${source}` : source)
      else image.removeAttribute('src')
    } else if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(source)) {
      image.removeAttribute('src')
    }
  }

  for (const element of Array.from(mailDocument.querySelectorAll('[background]'))) {
    const source = element.getAttribute('background')?.trim() || ''
    if (/^(?:https:)?\/\//i.test(source)) {
      hasRemoteImages = true
      if (showRemoteImages) element.setAttribute('background', source.startsWith('//') ? `https:${source}` : source)
      else element.removeAttribute('background')
    } else {
      element.removeAttribute('background')
    }
  }

  for (const link of Array.from(mailDocument.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href')?.trim() || ''
    if (/^\/\//.test(href)) link.setAttribute('href', `https:${href}`)
    else if (!/^https:\/\//i.test(href) && !/^mailto:/i.test(href)) link.removeAttribute('href')
    link.removeAttribute('target')
  }

  if (/url\([\s"']*(?:https?:)?\/\//i.test(Array.from(mailDocument.querySelectorAll('style, [style]'))
    .map((element) => element.textContent + ' ' + element.getAttribute('style')).join(' '))) hasRemoteImages = true

  const policy = mailDocument.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute('content', `default-src 'none'; img-src data:${showRemoteImages ? ' https:' : ''}; style-src 'unsafe-inline'; font-src 'none'; form-action 'none'; base-uri 'none'`)
  mailDocument.head.prepend(policy)
  const charset = mailDocument.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  mailDocument.head.insertBefore(charset, policy.nextSibling)
  const layout = mailDocument.createElement('style')
  layout.textContent = 'html,body{margin:0;min-height:0}body{overflow-wrap:anywhere;color:#364158;font:14px/1.65 Arial,sans-serif}img{max-width:100%;height:auto}table{max-width:100%}'
  mailDocument.head.append(layout)
  return { html: `<!doctype html>${mailDocument.documentElement.outerHTML}`, hasRemoteImages }
}

export function MailHtmlView({ detail, onOpenLink }: {
  detail: MailDetail
  onOpenLink: (url: string) => void
}): React.JSX.Element {
  const [showRemoteImages, setShowRemoteImages] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const document = useMemo(() => buildMailDocument(detail, showRemoteImages), [detail, showRemoteImages])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let observer: ResizeObserver | undefined
    let mailDocument: Document | null = null
    const resize = (): void => {
      if (mailDocument?.body) frame.style.height = `${Math.max(120, mailDocument.body.scrollHeight, mailDocument.documentElement.scrollHeight)}px`
    }
    const followLink = (event: MouseEvent): void => {
      const target = event.target as Node | null
      const element = target?.nodeType === 1 ? target as Element : target?.parentElement
      const link = element?.closest('a[href]')
      if (!link) return
      event.preventDefault()
      const href = link.getAttribute('href')
      if (href) onOpenLink(href)
    }
    const ready = (): void => {
      observer?.disconnect()
      mailDocument?.removeEventListener('click', followLink)
      mailDocument = frame.contentDocument
      if (!mailDocument?.body) return
      mailDocument.addEventListener('click', followLink)
      observer = new ResizeObserver(resize)
      observer.observe(mailDocument.body)
      resize()
    }
    frame.addEventListener('load', ready)
    ready()
    return () => {
      frame.removeEventListener('load', ready)
      observer?.disconnect()
      mailDocument?.removeEventListener('click', followLink)
    }
  }, [document.html, onOpenLink])

  return <div className="mail-rich-body">
    {document.hasRemoteImages && !showRemoteImages &&
      <div className="remote-images-note"><span>远程图片已拦截</span><Button size="small" onClick={() => setShowRemoteImages(true)}>加载图片</Button></div>}
    <iframe ref={frameRef} title="邮件正文" sandbox="allow-same-origin" srcDoc={document.html} />
  </div>
}
