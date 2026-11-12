import React, { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Select } from 'antd'
import type { Account, MailDraft, SavedDraft } from '../../../../shared/models'

export function ComposeDialogs({ error, accounts, promptOpen, prompt, promptBusy, composeOpen, preview,
  composeBusy, draft, savedDrafts, activeDraftId, draftSaving, dirty,
  onPromptOpen, onPrompt, onGenerate, onClose, onPreview, onDraft, onSaveDraft, onLoadDraft, onDeleteDraft, onSend }: {
  error: string; accounts: Account[]; promptOpen: boolean; prompt: string; promptBusy: boolean
  composeOpen: boolean; preview: boolean; composeBusy: boolean; draft: MailDraft
  savedDrafts: SavedDraft[]; activeDraftId: string; draftSaving: boolean; dirty: boolean
  onPromptOpen: (open: boolean) => void; onPrompt: (value: string) => void; onGenerate: () => void
  onClose: () => void; onPreview: (preview: boolean) => void; onDraft: (draft: MailDraft) => void
  onSaveDraft: () => void; onLoadDraft: (id: string) => void; onDeleteDraft: () => void; onSend: () => void
}): React.JSX.Element {
  const [toInput, setToInput] = useState('')
  const [ccInput, setCcInput] = useState('')
  const [bccInput, setBccInput] = useState('')
  const parseAddresses = (value: string): string[] => [...new Set(value.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean))]
  useEffect(() => {
    if (!composeOpen) return
    setToInput(draft.to.join(', '))
    setCcInput(draft.cc.join(', '))
    setBccInput(draft.bcc.join(', '))
  }, [composeOpen, activeDraftId])
  return <>
    <Modal open={promptOpen} title="一句话写邮件" footer={null} onCancel={() => onPromptOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>写信要求</label><Input.TextArea rows={5} value={prompt}
        placeholder="给 teacher@example.com 写邮件，说明周五提交课程报告，语气礼貌"
        onChange={(event) => onPrompt(event.target.value)} /></div>
      <div className="modal-actions"><Button onClick={() => onPromptOpen(false)}>取消</Button>
        <Button type="primary" loading={promptBusy} onClick={onGenerate}>生成草稿</Button></div>
    </Modal>

    <Modal open={composeOpen} title={preview ? '确认发送' : '撰写邮件'} width={700} footer={null}
      onCancel={onClose} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      {!preview ? <>
        <div className="field"><label>已保存草稿</label><div className="model-picker">
          <Select value={activeDraftId || undefined} placeholder="选择草稿继续编辑" allowClear
            options={savedDrafts.map((item) => ({
              value: item.id,
              label: `${item.draft.subject || item.draft.to[0] || '未命名草稿'} · ${new Date(item.updatedAt).toLocaleString()}`
            }))} onChange={(value?: string) => { if (value) onLoadDraft(value) }} />
          <Button danger disabled={!activeDraftId} onClick={onDeleteDraft}>删除草稿</Button>
        </div></div>
        <div className="field"><label>发件账户</label><Select value={draft.accountId}
          options={accounts.map((account) => ({ label: account.address, value: account.id }))}
          onChange={(value: string) => onDraft({ ...draft, accountId: value })} /></div>
        <div className="field"><label>收件人</label><Input value={toInput} placeholder="name@example.com"
          onChange={(event) => { setToInput(event.target.value); onDraft({ ...draft, to: parseAddresses(event.target.value) }) }} />
          <span className="field-help">多个地址使用逗号、分号或换行分隔。</span></div>
        <div className="field"><label>抄送</label><Input value={ccInput} placeholder="cc@example.com"
          onChange={(event) => { setCcInput(event.target.value); onDraft({ ...draft, cc: parseAddresses(event.target.value) }) }} /></div>
        <div className="field"><label>密送</label><Input value={bccInput} placeholder="bcc@example.com"
          onChange={(event) => { setBccInput(event.target.value); onDraft({ ...draft, bcc: parseAddresses(event.target.value) }) }} /></div>
        <div className="field"><label>主题</label><Input value={draft.subject} placeholder="邮件主题"
          onChange={(event) => onDraft({ ...draft, subject: event.target.value })} /></div>
        <div className="field"><label>正文</label><Input.TextArea rows={9} value={draft.text}
          onChange={(event) => onDraft({ ...draft, text: event.target.value })} /></div>
        {dirty && <p className="small-note">有尚未保存的修改。</p>}
        <div className="modal-actions"><Button onClick={onClose}>取消</Button>
          <Button loading={draftSaving} disabled={!draft.to.length && !draft.cc.length && !draft.bcc.length && !draft.subject.trim() && !draft.text.trim()}
            onClick={onSaveDraft}>保存草稿</Button>
          <Button type="primary" onClick={() => onPreview(true)}>预览</Button></div>
      </> : <>
        <div className="compose-preview">
          <p><strong>发件人：</strong>{accounts.find((account) => account.id === draft.accountId)?.address}</p>
          <p><strong>收件人：</strong>{draft.to.join(', ') || '未填写'}</p>
          <p><strong>抄送：</strong>{draft.cc.join(', ') || '无'}</p>
          <p><strong>密送：</strong>{draft.bcc.join(', ') || '无'}</p>
          <p><strong>主题：</strong>{draft.subject || '未填写'}</p>
          <div className="reader-divider" />
          <p>{draft.text || '未填写正文'}</p>
        </div>
        <p className="small-note">确认后将立即发送。</p>
        <div className="modal-actions"><Button onClick={() => onPreview(false)}>返回编辑</Button>
          <Button type="primary" loading={composeBusy} onClick={onSend}>确认发送</Button></div>
      </>}
    </Modal>
  </>
}
