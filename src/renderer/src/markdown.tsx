import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const CITATION = /\[(\d+)\]/g
const CITATION_PREFIX = '#cite-'

/**
 * 渲染 AI 返回的 Markdown 文本。原始 HTML 默认不解析；模型回答里的 [编号] 若传入 onCitation，
 * 会变成可点击的来源标记。链接不直接跳转，交给 openMailLink 判断能否用系统浏览器打开。
 */
export function Markdown({ text, onLink, onCitation }: {
  text: string
  onLink?: (url: string) => void
  onCitation?: (index: number) => void
}): React.JSX.Element {
  const source = onCitation
    ? text.replace(CITATION, (whole, index: string) => `[\\[${index}\\]](${CITATION_PREFIX}${index})`)
    : text
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => {
      const citation = href?.startsWith(CITATION_PREFIX) ? Number(href.slice(CITATION_PREFIX.length)) : NaN
      if (onCitation && Number.isSafeInteger(citation)) {
        return <button type="button" className="agent-inline-source" onClick={() => onCitation(citation)}>{children}</button>
      }
      return <a href={href} onClick={(event) => {
        event.preventDefault()
        if (href) onLink?.(href)
      }}>{children}</a>
    }
  }}>{source}</ReactMarkdown></div>
}
