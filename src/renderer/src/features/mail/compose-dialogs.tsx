import React from 'react'
import { Alert, Button, Input, Modal, Select } from 'antd'
import type { Account, MailDraft } from '../../../../shared/models'

export function ComposeDialogs({ error, accounts, promptOpen, prompt, promptBusy, composeOpen, preview,
  composeBusy, draft, onPromptOpen, onPrompt, onGenerate, onComposeOpen, onPreview, onDraft, onSend }: {
  error: string; accounts: Account[]; promptOpen: boolean; prompt: string; promptBusy: boolean
  composeOpen: boolean; preview: boolean; composeBusy: boolean; draft: MailDraft
  onPromptOpen: (open: boolean) => void; onPrompt: (value: string) => void; onGenerate: () => void
  onComposeOpen: (open: boolean) => void; onPreview: (preview: boolean) => void
  onDraft: (draft: MailDraft) => void; onSend: () => void
}): React.JSX.Element {
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
      onCancel={() => { onComposeOpen(false); onPreview(false) }} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      {!preview ? <>
        <div className="field"><label>发件账户</label><Select value={draft.accountId}
          options={accounts.map((account) => ({ label: account.address, value: account.id }))}
          onChange={(value: string) => onDraft({ ...draft, accountId: value })} /></div>
        <div className="field"><label>收件人</label><Input value={draft.to} placeholder="name@example.com"
          onChange={(event) => onDraft({ ...draft, to: event.target.value })} /></div>
        <div className="field"><label>主题</label><Input value={draft.subject}
          onChange={(event) => onDraft({ ...draft, subject: event.target.value })} /></div>
        <div className="field"><label>正文</label><Input.TextArea rows={9} value={draft.text}
          onChange={(event) => onDraft({ ...draft, text: event.target.value })} /></div>
        <div className="modal-actions"><Button onClick={() => onComposeOpen(false)}>取消</Button>
          <Button type="primary" onClick={() => onPreview(true)}>预览</Button></div>
      </> : <>
        <div className="compose-preview">
          <p><strong>发件人：</strong>{accounts.find((account) => account.id === draft.accountId)?.address}</p>
          <p><strong>收件人：</strong>{draft.to || '未填写'}</p>
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
