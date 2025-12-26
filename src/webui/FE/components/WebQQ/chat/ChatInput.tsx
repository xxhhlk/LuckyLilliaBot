import React, { useRef, useCallback, useState, forwardRef, useImperativeHandle, useEffect } from 'react'
import { Send, Loader2, Smile, Image as ImageIcon, Paperclip, Reply, X } from 'lucide-react'
import { RichInput, RichInputRef, RichInputItem, MentionState } from './RichInput'
import { MentionPicker } from './MentionPicker'
import { EmojiPicker } from '../message/EmojiPicker'
import { sendMessage, uploadImage, uploadFile, isValidImageFormat, getGroupMembers } from '../../../utils/webqqApi'
import { showToast } from '../../common'
import type { ChatSession, RawMessage, GroupMemberItem } from '../../../types/webqq'

export interface ChatInputRef {
  insertAt: (uid: string, uin: string, name: string) => void
}

interface ChatInputProps {
  session: ChatSession | null
  replyTo: RawMessage | null
  onReplyCancel: () => void
  onSendStart: () => void
  onSendEnd: () => void
  onTempMessage: (msg: { msgId: string; text?: string; imageUrl?: string; timestamp: number; status: 'sending' | 'failed' }) => void
  onTempMessageRemove: (msgId: string) => void
  onTempMessageFail: (msgId: string) => void
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>((props, ref) => {
  const { session, replyTo, onReplyCancel, onSendStart, onSendEnd, onTempMessage, onTempMessageRemove, onTempMessageFail } = props
  
  const richInputRef = useRef<RichInputRef>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileUploadInputRef = useRef<HTMLInputElement>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [pendingFile, setPendingFile] = useState<{ file: File; name: string; size: number } | null>(null)
  const [sending, setSending] = useState(false)
  const [hasContent, setHasContent] = useState(false)
  
  // @ 提及相关状态
  const [mentionState, setMentionState] = useState<MentionState>({ active: false, query: '', position: { top: 0, left: 0 } })
  const [groupMembers, setGroupMembers] = useState<GroupMemberItem[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const membersLoadedRef = useRef<string | null>(null)

  useImperativeHandle(ref, () => ({
    insertAt: (uid: string, uin: string, name: string) => {
      richInputRef.current?.insertAt(uid, uin, name)
    }
  }), [])

  // 当群聊会话变化时，预加载群成员
  useEffect(() => {
    if (session?.chatType === 2 && session.peerId !== membersLoadedRef.current) {
      setMembersLoading(true)
      getGroupMembers(session.peerId)
        .then(members => {
          setGroupMembers(members)
          membersLoadedRef.current = session.peerId
        })
        .catch(() => setGroupMembers([]))
        .finally(() => setMembersLoading(false))
    }
  }, [session?.chatType, session?.peerId])

  // 处理 @ 状态变化
  const handleMentionChange = useCallback((state: MentionState) => {
    // 只有群聊才显示 @ 选择器
    if (session?.chatType !== 2) {
      setMentionState({ active: false, query: '', position: { top: 0, left: 0 } })
      return
    }
    setMentionState(state)
  }, [session?.chatType])

  // 选择 @ 成员
  const handleMentionSelect = useCallback((member: GroupMemberItem) => {
    richInputRef.current?.insertAt(member.uid, member.uin, member.card || member.nickname)
  }, [])

  // 关闭 @ 选择器
  const handleMentionClose = useCallback(() => {
    richInputRef.current?.cancelMention()
  }, [])

  const handleSend = useCallback(async () => {
    if (!session || !richInputRef.current) return
    const items = richInputRef.current.getContent()
    const isEmpty = richInputRef.current.isEmpty()
    const hasFile = !!pendingFile
    if (isEmpty && !hasFile) return
    
    setSending(true)
    onSendStart()
    const currentReplyTo = replyTo
    const currentFile = pendingFile
    richInputRef.current.clear()
    onReplyCancel()
    setPendingFile(null)
    setHasContent(false)

    const previewText = items.map(item => {
      if (item.type === 'text') return item.content
      if (item.type === 'face') return '[表情]'
      if (item.type === 'image') return '[图片]'
      if (item.type === 'at') return `@${item.atName}`
      return ''
    }).join('') || (currentFile ? `[文件] ${currentFile.name}` : '')
    
    const tempId = `temp_${Date.now()}`
    const imageItem = items.find(i => i.type === 'image')
    onTempMessage({ msgId: tempId, text: previewText || undefined, imageUrl: imageItem?.imageUrl, timestamp: Date.now(), status: 'sending' })

    try {
      const content: any[] = []
      if (currentReplyTo) content.push({ type: 'reply', msgId: currentReplyTo.msgId, msgSeq: currentReplyTo.msgSeq })
      
      for (const item of items) {
        if (item.type === 'text' && item.content) content.push({ type: 'text', text: item.content })
        else if (item.type === 'face' && item.faceId !== undefined) content.push({ type: 'face', faceId: item.faceId })
        else if (item.type === 'image' && item.imageFile) {
          const uploadResult = await uploadImage(item.imageFile)
          content.push({ type: 'image', imagePath: uploadResult.imagePath })
        } else if (item.type === 'at' && item.atUid) content.push({ type: 'at', uid: item.atUid, uin: item.atUin, name: item.atName })
      }
      
      if (currentFile) {
        const uploadResult = await uploadFile(currentFile.file)
        content.push({ type: 'file', filePath: uploadResult.filePath, fileName: uploadResult.fileName })
      }
      
      if (content.length === 0) { onTempMessageRemove(tempId); return }
      await sendMessage({ chatType: session.chatType, peerId: session.peerId, content })
      onTempMessageRemove(tempId)
    } catch (e: any) {
      showToast('发送失败', 'error')
      onTempMessageFail(tempId)
    } finally {
      setSending(false)
      onSendEnd()
      setTimeout(() => richInputRef.current?.focus(), 50)
    }
  }, [session, replyTo, pendingFile, onSendStart, onSendEnd, onReplyCancel, onTempMessage, onTempMessageRemove, onTempMessageFail])

  const handleEmojiSelect = useCallback((faceId: number) => {
    richInputRef.current?.insertFace(faceId)
    setShowEmojiPicker(false)
  }, [])

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isValidImageFormat(file.name)) { showToast('不支持的图片格式，仅支持 JPG、PNG、GIF', 'error'); return }
    richInputRef.current?.insertImage(file, URL.createObjectURL(file))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 100 * 1024 * 1024) { showToast('文件过大，最大支持 100MB', 'error'); return }
    setPendingFile({ file, name: file.name, size: file.size })
    if (fileUploadInputRef.current) fileUploadInputRef.current.value = ''
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (!file) continue
        const ext = file.type.split('/')[1]?.toLowerCase()
        if (!['jpeg', 'jpg', 'png', 'gif'].includes(ext)) { showToast('不支持的图片格式', 'error'); return }
        richInputRef.current?.insertImage(file, URL.createObjectURL(file))
        return
      }
    }
  }, [])

  const handleContentChange = useCallback((items: RichInputItem[]) => {
    setHasContent(items.length > 0 && !(items.length === 1 && items[0].type === 'text' && !items[0].content?.trim()))
  }, [])

  return (
    <div className="border-t border-theme-divider bg-theme-card">
      {replyTo && (
        <div className="px-4 py-2 border-b border-theme-divider bg-theme-item">
          <div className="flex items-center gap-2">
            <Reply size={16} className="text-pink-500 flex-shrink-0" />
            <div className="flex-1 min-w-0 text-sm text-theme-secondary truncate">
              回复 {replyTo.sendMemberName || replyTo.sendNickName || replyTo.senderUin}：
              {replyTo.elements?.filter(el => !el.replyElement).map((el, i) => {
                if (el.textElement) return <span key={i}>{el.textElement.content}</span>
                if (el.picElement) return <span key={i}>[图片]</span>
                if (el.faceElement) return <span key={i}>[表情]</span>
                return null
              })}
            </div>
            <button onClick={onReplyCancel} className="p-1 text-theme-hint hover:text-theme rounded"><X size={16} /></button>
          </div>
        </div>
      )}

      {pendingFile && (
        <div className="px-4 py-2 border-b border-theme-divider bg-theme-item">
          <div className="flex items-center gap-2">
            <Paperclip size={16} className="text-green-500 flex-shrink-0" />
            <div className="flex-1 min-w-0 text-sm text-theme-secondary truncate">
              {pendingFile.name} ({(pendingFile.size / 1024).toFixed(1)} KB)
            </div>
            <button onClick={() => setPendingFile(null)} className="p-1 text-theme-hint hover:text-theme rounded"><X size={16} /></button>
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <div className="flex items-center gap-1 mb-2 relative">
          <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} disabled={sending} className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${showEmojiPicker ? 'text-pink-500 bg-pink-50 dark:bg-pink-900/30' : 'text-theme-muted hover:text-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/30'}`} title="表情">
            <Smile size={18} />
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={sending} className="p-2 text-theme-muted hover:text-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/30 rounded-lg transition-colors disabled:opacity-50" title="图片">
            <ImageIcon size={18} />
          </button>
          <button onClick={() => fileUploadInputRef.current?.click()} disabled={sending} className="p-2 text-theme-muted hover:text-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/30 rounded-lg transition-colors disabled:opacity-50" title="文件">
            <Paperclip size={18} />
          </button>
          {showEmojiPicker && <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />}
        </div>

        <div className="flex items-end gap-2 relative">
          <input type="file" ref={fileInputRef} onChange={handleImageSelect} accept="image/jpeg,image/png,image/gif" className="hidden" />
          <input type="file" ref={fileUploadInputRef} onChange={handleFileSelect} className="hidden" />
          <div className="flex-1 bg-theme-input border border-theme-input rounded-xl focus-within:ring-2 focus-within:ring-pink-500/20 overflow-hidden">
            <RichInput 
              ref={richInputRef} 
              placeholder="输入消息..." 
              disabled={sending} 
              onEnter={handleSend} 
              onPaste={handlePaste} 
              onChange={handleContentChange}
              onMentionChange={handleMentionChange}
            />
          </div>
          {/* @ 提及选择器 - 放在输入框外面避免 overflow 裁剪 */}
          {mentionState.active && session?.chatType === 2 && (
            <MentionPicker
              members={groupMembers}
              loading={membersLoading}
              query={mentionState.query}
              position={mentionState.position}
              onSelect={handleMentionSelect}
              onClose={handleMentionClose}
            />
          )}
          <button onClick={handleSend} disabled={sending || (!hasContent && !pendingFile)} className="p-2.5 bg-pink-500 text-white rounded-xl hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0">
            {sending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        </div>
      </div>
    </div>
  )
})

ChatInput.displayName = 'ChatInput'
export default ChatInput
