import React, { useState } from 'react'
import { Alert, Button, Empty, Input, Select, Spin } from 'antd'
import type { MailAttachment, MailDetail, MailSearchQuery, MailSummary } from '../../../../shared/models'
import { MailHtmlView } from '../../mail-html'
import { Icon } from '../../icons'

const shortDate = (date: string): string => {
  const value = new Date(date)
  const today = new Date()
  if (value.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(value)
  }
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(value)
}

export function MailView({ accountId, mails, selected, detail, mailLoading, detailLoading,
  search, warnings, truncated, hasMore, loadingMore,
  onSearch, onApplySearch, onClearSearch, onLoadMore, onOpenMail, onOpenLink, onSaveAttachment, onReply }: {
  accountId: string; mails: MailSummary[]; selected: MailSummary | null; detail: MailDetail | null
  mailLoading: boolean; detailLoading: boolean
  search: MailSearchQuery; warnings: string[]; truncated: boolean; hasMore: boolean; loadingMore: boolean
  onSearch: (query: MailSearchQuery) => void; onApplySearch: () => void; onClearSearch: () => void; onLoadMore: () => void
  onOpenMail: (mail: MailSummary) => void; onOpenLink: (url: string) => void
  onSaveAttachment: (attachment: MailAttachment) => Promise<string | undefined>; onReply: () => void
}): React.JSX.Element {
  const [attachmentBusy, setAttachmentBusy] = useState('')
  const [attachmentNotice, setAttachmentNotice] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const applyFilters = (): void => { onApplySearch(); setFiltersOpen(false) }
  const clearFilters = (): void => { onClearSearch(); setFiltersOpen(false) }
  const saveAttachment = async (attachment: MailAttachment): Promise<void> => {
    setAttachmentBusy(attachment.id)
    setAttachmentNotice('')
    try {
      const saved = await onSaveAttachment(attachment)
      if (saved) setAttachmentNotice(`已保存附件：${saved}`)
    } finally { setAttachmentBusy('') }
  }
  return <section className="content">
    <div className="mail-list">
      <div className="mail-list-head"><span>邮件列表</span><span>{mails.length} 封</span></div>
      <div className="mail-search">
        <div className="mail-search-quick">
          <Icon name="search" size={14} />
          <Input variant="borderless" size="small" placeholder="主题" value={search.subject || ''}
            onChange={(event) => onSearch({ ...search, subject: event.target.value })} onPressEnter={applyFilters} />
          <button type="button" className={`filter-toggle ${filtersOpen ? 'is-open' : ''}`}
            aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
            <Icon name="filter" size={14} />筛选
          </button>
        </div>
        <div className={`mail-filters ${filtersOpen ? 'is-open' : ''}`} aria-hidden={!filtersOpen}>
          <label className="filter-field"><span>发件人</span>
            <Input size="small" placeholder="发件人" value={search.from || ''}
              onChange={(event) => onSearch({ ...search, from: event.target.value })} /></label>
          <label className="filter-field"><span>起始日期</span>
            <Input size="small" type="date" value={search.since || ''}
              onChange={(event) => onSearch({ ...search, since: event.target.value || undefined })} /></label>
          <label className="filter-field"><span>结束日期</span>
            <Input size="small" type="date" value={search.before || ''}
              onChange={(event) => onSearch({ ...search, before: event.target.value || undefined })} /></label>
          <label className="filter-field"><span>状态</span>
            <Select size="small" value={search.unread === undefined ? 'all' : search.unread ? 'unread' : 'read'}
              onChange={(value) => onSearch({ ...search, unread: value === 'all' ? undefined : value === 'unread' })}
              options={[{ value: 'all', label: '全部状态' }, { value: 'unread', label: '仅未读' }, { value: 'read', label: '仅已读' }]} /></label>
          <div className="mail-search-actions">
            <Button size="small" type="primary" onClick={applyFilters}>搜索</Button>
            <Button size="small" onClick={clearFilters}>清除</Button>
          </div>
        </div>
      </div>
      {warnings.map((warning, index) => <Alert key={`${warning}-${index}`} type="warning" title={warning} showIcon />)}
      {truncated && <Alert type="info" title="搜索结果超过 200 封，仅提供最近 200 封，请缩小条件。" showIcon />}
      {mailLoading ? <div className="top-spinner"><Spin /></div> : mails.length ? mails.map((mail) =>
        <button key={`${mail.folder}-${mail.uid}`}
          className={`mail-row ${mail.unread ? 'unread' : ''} ${selected?.uid === mail.uid ? 'selected' : ''}`}
          onClick={() => onOpenMail(mail)}>
          <time className="mail-row-date" dateTime={mail.date}>{shortDate(mail.date)}</time>
          <span className={`mail-dot ${mail.unread ? '' : 'is-read'}`} />
          <span className="mail-row-main">
            <span className="mail-row-from">{mail.from}</span>
            <span className="mail-row-subject">{mail.subject}</span>
          </span>
        </button>) : <Empty description={accountId ? '当前文件夹或搜索条件下没有邮件' : '请先添加邮箱账户'} />}
      {!mailLoading && hasMore && <div className="mail-load-more"><Button loading={loadingMore} onClick={onLoadMore}>继续加载</Button></div>}
    </div>
    <div className="reader">
      {detailLoading ? <div className="top-spinner"><Spin /></div> : detail ? <article className="reader-card">
        <h2>{detail.subject}</h2>
        <div className="reader-meta">
          <div><strong>发件人</strong>{detail.from}</div>
          <div><strong>收件人</strong>{detail.to}</div>
          <div><strong>时间</strong><time dateTime={detail.date}>{new Date(detail.date).toLocaleString('zh-CN')}</time></div>
          {detail.attachments.length > 0 && <div className="attachment-list"><strong>附件</strong>
            {detail.attachments.map((attachment) => <Button key={attachment.id} size="small"
              disabled={!attachment.downloadable} loading={attachmentBusy === attachment.id}
              title={attachment.reason} onClick={() => void saveAttachment(attachment)}>
              {attachment.name}（{Math.max(1, Math.ceil(attachment.size / 1024))} KB）
            </Button>)}
            {attachmentNotice && <span className="attachment-notice">{attachmentNotice}</span>}
          </div>}
        </div>
        <div className="reader-divider" />
        {detail.html ? <MailHtmlView key={`${detail.accountId}-${detail.folder}-${detail.uid}`}
          detail={detail} onOpenLink={onOpenLink} /> : <div className="mail-body">{detail.text}</div>}
        <div className="reader-actions"><Button icon={<Icon name="reply" />} onClick={onReply}>回复</Button></div>
      </article> : <div className="empty-pane"><Empty description="选择一封邮件查看" /></div>}
    </div>
  </section>
}
