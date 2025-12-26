import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Users, Send, Image as ImageIcon, X, Loader2, Reply, Trash2, AtSign, Hand, User, UserMinus } from 'lucide-react'
import type { ChatSession, RawMessage } from '../../types/webqq'
import { getMessages, sendMessage, uploadImage, isEmptyMessage, isValidImageFormat, getSelfUid, recallMessage, sendPoke, getUserProfile, UserProfile, getGroupMembers, kickGroupMember } from '../../utils/webqqApi'
import { useWebQQStore, hasVisitedChat, markChatVisited, unmarkChatVisited } from '../../stores/webqqStore'
import { getCachedMessages, setCachedMessages, appendCachedMessage, removeCachedMessage } from '../../utils/messageDb'
import { showToast } from '../Toast'

import { UserProfileCard } from './UserProfileCard'
import { ImagePreviewModal, VideoPreviewModal } from './PreviewModals'
import { ImagePreviewContext, VideoPreviewContext } from './MessageElements'
import { RawMessageBubble, TempMessageBubble, MessageContextMenuContext, AvatarContextMenuContext, ScrollToMessageContext, GroupMembersContext } from './MessageBubble'
import type { TempMessage, AvatarContextMenuInfo } from './MessageBubble'

interface ChatWindowProps {
  session: ChatSession | null
  onShowMembers?: () => void
  onNewMessageCallback?: (callback: ((msg: RawMessage) => void) | null) => void
  appendInputText?: string
  onAppendInputTextConsumed?: () => void
}

type MessageItem = { type: 'raw'; data: RawMessage } | { type: 'temp'; data: TempMessage }

const ChatWindow: React.FC<ChatWindowProps> = ({ session, onShowMembers, onNewMessageCallback, appendInputText, onAppendInputTextConsumed }) => {
  const [messages, setMessages] = useState<RawMessage[]>([])
  const [tempMessages, setTempMessages] = useState<TempMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [imagePreview, setImagePreview] = useState<{ file: File; url: string } | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [previewVideoUrl, setPreviewVideoUrl] = useState<{ chatType: number; peerUid: string; msgId: string; elementId: string } | null>(null)
  const [replyTo, setReplyTo] = useState<RawMessage | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: RawMessage } | null>(null)
  const [avatarContextMenu, setAvatarContextMenu] = useState<AvatarContextMenuInfo | null>(null)
  const [userProfile, setUserProfile] = useState<{ profile: UserProfile | null; loading: boolean; position: { x: number; y: number } } | null>(null)
  const [isScrollReady, setIsScrollReady] = useState(false)
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null)
  const [kickConfirm, setKickConfirm] = useState<{ uid: string; name: string; groupCode: string; groupName: string } | null>(null)

  const imagePreviewContextValue = useMemo(() => ({
    showPreview: (url: string) => setPreviewImageUrl(url)
  }), [])
  
  const videoPreviewContextValue = useMemo(() => ({
    showPreview: (chatType: number, peerUid: string, msgId: string, elementId: string) => 
      setPreviewVideoUrl({ chatType, peerUid, msgId, elementId })
  }), [])
  
  const messageContextMenuValue = useMemo(() => ({
    showMenu: (e: React.MouseEvent, message: RawMessage) => {
      setContextMenu({ x: e.clientX, y: e.clientY, message })
    }
  }), [])
  
  const avatarContextMenuValue = useMemo(() => ({
    showMenu: (e: React.MouseEvent, info: Omit<AvatarContextMenuInfo, 'x' | 'y'>) => {
      setAvatarContextMenu({ x: e.clientX, y: e.clientY, ...info })
    }
  }), [])
  
  const { getCachedMembers, setCachedMembers } = useWebQQStore()
  
  // 进入群聊时自动加载群成员（用于显示等级和头衔）
  useEffect(() => {
    if (session?.chatType === 2) {
      const groupCode = session.peerId
      // 如果缓存中没有群成员，自动加载
      if (!getCachedMembers(groupCode)) {
        getGroupMembers(groupCode).then(members => {
          setCachedMembers(groupCode, members)
        }).catch(() => {
          // 忽略错误，不影响聊天功能
        })
      }
    }
  }, [session?.chatType, session?.peerId, getCachedMembers, setCachedMembers])
  
  const parentRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sessionRef = useRef(session)
  const shouldScrollRef = useRef(true)
  const prevSessionKeyRef = useRef<string | null>(null)
  const allItemsRef = useRef<MessageItem[]>([])
  const messageCacheRef = useRef<Map<string, RawMessage[]>>(new Map())
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const isLoadingMoreRef = useRef(false)
  const scrollToMsgIdRef = useRef<string | null>(null)
  const isFirstMountRef = useRef(true)
  
  useEffect(() => { sessionRef.current = session }, [session])

  useEffect(() => {
    if (appendInputText) {
      setInputText(prev => prev + appendInputText)
      textareaRef.current?.focus()
      onAppendInputTextConsumed?.()
    }
  }, [appendInputText, onAppendInputTextConsumed])

  const allItems = useMemo<MessageItem[]>(() => {
    const seen = new Set<string>()
    const rawItems: MessageItem[] = messages
      .filter(msg => {
        if (!msg || !msg.elements || !Array.isArray(msg.elements)) return false
        if (seen.has(msg.msgId)) return false
        seen.add(msg.msgId)
        return true
      })
      .map(msg => ({ type: 'raw' as const, data: msg }))
    
    const tempItems: MessageItem[] = tempMessages.map(msg => ({ type: 'temp' as const, data: msg }))
    const items = [...rawItems, ...tempItems]
    allItemsRef.current = items
    return items
  }, [messages, tempMessages])

  const virtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  })

  const scrollToMessage = useCallback((msgId: string, msgSeq?: string) => {
    const index = allItems.findIndex(item => {
      if (item.type !== 'raw') return false
      return item.data.msgId === msgId || (msgSeq && item.data.msgSeq === msgSeq)
    })
    if (index !== -1) {
      virtualizer.scrollToIndex(index, { align: 'center' })
      const targetMsg = allItems[index]
      if (targetMsg.type === 'raw') {
        setHighlightMsgId(targetMsg.data.msgId)
        setTimeout(() => setHighlightMsgId(null), 2000)
      }
    }
  }, [allItems, virtualizer])

  const scrollToMessageContextValue = useMemo(() => ({ scrollToMessage }), [scrollToMessage])

  const groupMembersContextValue = useMemo(() => ({
    getMembers: (groupCode: string) => getCachedMembers(groupCode)
  }), [getCachedMembers])

  const scrollToBottom = useCallback(() => {
    if (allItemsRef.current.length > 0) {
      virtualizer.scrollToIndex(allItemsRef.current.length - 1, { align: 'end' })
    }
  }, [virtualizer])

  useEffect(() => {
    if (allItems.length === 0) return
    const currentKey = session ? `${session.chatType}_${session.peerId}` : null
    const isNewSession = currentKey !== prevSessionKeyRef.current
    if (isNewSession && currentKey) {
      prevSessionKeyRef.current = currentKey
      setIsScrollReady(false)
      const scrollToEnd = () => { if (parentRef.current) parentRef.current.scrollTop = parentRef.current.scrollHeight }
      scrollToEnd()
      setTimeout(() => { scrollToEnd(); setIsScrollReady(true) }, 50)
    }
  }, [session?.chatType, session?.peerId, allItems.length])

  useEffect(() => { prevSessionKeyRef.current = null; setIsScrollReady(false) }, [session?.chatType, session?.peerId])

  useEffect(() => {
    if (shouldScrollRef.current && allItems.length > 0) {
      scrollToBottom()
      shouldScrollRef.current = false
    }
  }, [allItems.length, scrollToBottom])

  useEffect(() => {
    if (onNewMessageCallback) {
      const handleNewMessage = (msg: RawMessage) => {
        if (!msg || !msg.msgId || !msg.elements || !Array.isArray(msg.elements)) return
        setMessages(prev => {
          if (prev.some(m => m && m.msgId === msg.msgId)) return prev
          const newMessages = [...prev, msg]
          const currentSession = sessionRef.current
          if (currentSession) appendCachedMessage(currentSession.chatType, currentSession.peerId, msg)
          return newMessages
        })
        setTempMessages(prev => prev.filter(t => t.status !== 'sending'))
      }
      onNewMessageCallback(handleNewMessage)
    }
    return () => { if (onNewMessageCallback) onNewMessageCallback(null) }
  }, [onNewMessageCallback])

  const getSessionKey = (chatType: number | string, peerId: string) => `${chatType}_${peerId}`

  const loadMessages = useCallback(async (beforeMsgSeq?: string) => {
    if (!session) return
    const requestChatType = session.chatType
    const requestPeerId = session.peerId

    if (beforeMsgSeq) setLoadingMore(true)
    else setLoading(true)

    if (beforeMsgSeq && messages.length > 0) scrollToMsgIdRef.current = messages[0]?.msgId || null

    try {
      const result = await getMessages(requestChatType, requestPeerId, beforeMsgSeq)
      const currentSession = sessionRef.current
      const sessionChanged = !currentSession || currentSession.chatType !== requestChatType || currentSession.peerId !== requestPeerId
      
      const validMessages = result.messages.filter((msg): msg is RawMessage => 
        msg !== null && msg !== undefined && msg.elements && Array.isArray(msg.elements)
      )
      
      if (sessionChanged) {
        unmarkChatVisited(requestChatType, requestPeerId)
        const sessionKey = getSessionKey(requestChatType, requestPeerId)
        const existingCache = messageCacheRef.current.get(sessionKey) || []
        const existingIds = new Set(existingCache.map(m => m.msgId))
        const newMsgs = validMessages.filter(m => !existingIds.has(m.msgId))
        const merged = beforeMsgSeq ? [...newMsgs, ...existingCache] : [...existingCache, ...newMsgs]
        merged.sort((a, b) => parseInt(a.msgTime) - parseInt(b.msgTime))
        messageCacheRef.current.set(sessionKey, merged)
        setCachedMessages(requestChatType, requestPeerId, merged)
        return
      }
      
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.msgId))
        const newMsgs = validMessages.filter(m => !existingIds.has(m.msgId))
        const merged = beforeMsgSeq ? [...newMsgs, ...prev] : [...prev, ...newMsgs]
        merged.sort((a, b) => parseInt(a.msgTime) - parseInt(b.msgTime))
        setCachedMessages(requestChatType, requestPeerId, merged)
        return merged
      })
      setHasMore(result.hasMore)
    } catch (e: any) {
      scrollToMsgIdRef.current = null
      const currentSession = sessionRef.current
      if (!currentSession || currentSession.chatType !== requestChatType || currentSession.peerId !== requestPeerId) return
      showToast(beforeMsgSeq ? '加载更多消息失败' : '加载消息失败', 'error')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [session, messages])
  
  useEffect(() => {
    const targetMsgId = scrollToMsgIdRef.current
    if (targetMsgId && allItems.length > 0) {
      const targetIndex = allItems.findIndex(item => item.type === 'raw' && item.data.msgId === targetMsgId)
      if (targetIndex !== -1) virtualizer.scrollToIndex(targetIndex, { align: 'start' })
      scrollToMsgIdRef.current = null
    }
  }, [allItems, virtualizer])

  useEffect(() => {
    if (session) {
      const sessionKey = getSessionKey(session.chatType, session.peerId)
      const currentChatType = session.chatType
      const currentPeerId = session.peerId
      
      const cachedInMemory = messageCacheRef.current.get(sessionKey)
      if (cachedInMemory && cachedInMemory.length > 0) setMessages(cachedInMemory)
      else setMessages([])
      
      getCachedMessages(currentChatType, currentPeerId).then(cachedMessages => {
        const currentSession = sessionRef.current
        if (!currentSession || currentSession.chatType !== currentChatType || currentSession.peerId !== currentPeerId) return
        if (cachedMessages && cachedMessages.length > 0) {
          const validMessages = cachedMessages.filter(m => m.elements && Array.isArray(m.elements))
          if (validMessages.length > 0) {
            messageCacheRef.current.set(sessionKey, validMessages)
            setMessages(validMessages)
          }
        }
      })
      
      setTempMessages([])
      shouldScrollRef.current = true
      
      if (isFirstMountRef.current || !hasVisitedChat(session.chatType, session.peerId)) {
        isFirstMountRef.current = false
        markChatVisited(session.chatType, session.peerId)
        loadMessages()
      }
    } else {
      setMessages([])
      setTempMessages([])
    }
  }, [session?.peerId, session?.chatType])

  useEffect(() => {
    if (session && messages.length > 0) {
      const sessionKey = getSessionKey(session.chatType, session.peerId)
      messageCacheRef.current.set(sessionKey, messages)
    }
  }, [messages, session?.chatType, session?.peerId])

  useEffect(() => {
    const sentinel = topSentinelRef.current
    const container = parentRef.current
    if (!sentinel || !container) return
    
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry.isIntersecting && hasMore && !isLoadingMoreRef.current && messages.length > 0) {
          const firstMsgSeq = messages[0]?.msgSeq
          if (firstMsgSeq) {
            isLoadingMoreRef.current = true
            loadMessages(firstMsgSeq).finally(() => { isLoadingMoreRef.current = false })
          }
        }
      },
      { root: container, rootMargin: '50px 0px 0px 0px', threshold: 0 }
    )
    
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, messages, loadMessages])

  const handleScroll = useCallback(() => {
    const container = parentRef.current
    if (!container || messages.length === 0) return
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    shouldScrollRef.current = isNearBottom
  }, [messages])

  const handleSendText = useCallback(async () => {
    if (!session || isEmptyMessage(inputText)) return
    setSending(true)
    const text = inputText.trim()
    const currentReplyTo = replyTo
    setInputText('')
    setReplyTo(null)
    shouldScrollRef.current = true

    const tempId = `temp_${Date.now()}`
    setTempMessages(prev => [...prev, { msgId: tempId, text, timestamp: Date.now(), status: 'sending' }])

    try {
      const content: { type: 'text' | 'image' | 'reply'; text?: string; msgId?: string; msgSeq?: string }[] = []
      if (currentReplyTo) content.push({ type: 'reply', msgId: currentReplyTo.msgId, msgSeq: currentReplyTo.msgSeq })
      content.push({ type: 'text', text })
      await sendMessage({ chatType: session.chatType, peerId: session.peerId, content })
      setTempMessages(prev => prev.filter(t => t.msgId !== tempId))
    } catch (e: any) {
      showToast('发送失败', 'error')
      setTempMessages(prev => prev.map(t => t.msgId === tempId ? { ...t, status: 'failed' as const } : t))
    } finally {
      setSending(false)
    }
  }, [session, inputText, replyTo])

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isValidImageFormat(file.name)) {
      showToast('不支持的图片格式，仅支持 JPG、PNG、GIF', 'error')
      return
    }
    setImagePreview({ file, url: URL.createObjectURL(file) })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleSendImage = useCallback(async () => {
    if (!session || !imagePreview) return
    setSending(true)
    const { file, url } = imagePreview
    setImagePreview(null)
    shouldScrollRef.current = true

    const tempId = `temp_${Date.now()}`
    setTempMessages(prev => [...prev, { msgId: tempId, imageUrl: url, timestamp: Date.now(), status: 'sending' }])

    try {
      const uploadResult = await uploadImage(file)
      await sendMessage({ chatType: session.chatType, peerId: session.peerId, content: [{ type: 'image', imagePath: uploadResult.imagePath }] })
      setTempMessages(prev => prev.filter(t => t.msgId !== tempId))
    } catch (e: any) {
      showToast('发送图片失败', 'error')
      setTempMessages(prev => prev.map(t => t.msgId === tempId ? { ...t, status: 'failed' as const } : t))
    } finally {
      setSending(false)
      URL.revokeObjectURL(url)
    }
  }, [session, imagePreview])

  const handleRetryTemp = useCallback((tempMsg: TempMessage) => {
    setTempMessages(prev => prev.filter(t => t.msgId !== tempMsg.msgId))
    if (tempMsg.text) setInputText(tempMsg.text)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText() }
  }, [handleSendText])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const ext = file.type.split('/')[1]?.toLowerCase()
        if (!['jpeg', 'jpg', 'png', 'gif'].includes(ext)) {
          showToast('不支持的图片格式，仅支持 JPG、PNG、GIF', 'error')
          return
        }
        setImagePreview({ file, url: URL.createObjectURL(file) })
        return
      }
    }
  }, [])

  const handleShowProfile = useCallback(async (uid: string, uin: string, x: number, y: number, groupCode?: string) => {
    setUserProfile({ profile: null, loading: true, position: { x, y } })
    try {
      const profile = await getUserProfile(uid, uin, groupCode)
      setUserProfile({ profile, loading: false, position: { x, y } })
    } catch {
      setUserProfile(null)
      showToast('获取用户资料失败', 'error')
    }
  }, [])

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center bg-theme-item">
        <div className="text-center text-theme-hint">
          <div className="text-6xl mb-4">💬</div>
          <p>选择一个联系人开始聊天</p>
        </div>
      </div>
    )
  }

  return (
    <ImagePreviewContext.Provider value={imagePreviewContextValue}>
    <VideoPreviewContext.Provider value={videoPreviewContextValue}>
    <MessageContextMenuContext.Provider value={messageContextMenuValue}>
    <AvatarContextMenuContext.Provider value={avatarContextMenuValue}>
    <ScrollToMessageContext.Provider value={scrollToMessageContextValue}>
    <GroupMembersContext.Provider value={groupMembersContextValue}>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-theme-divider bg-theme-card">
          <div className="flex items-center gap-3">
            <img src={session.peerAvatar} alt={session.peerName} className="w-10 h-10 rounded-full object-cover" />
            <div>
              <div className="font-medium text-theme">{session.peerName}</div>
              <div className="text-xs text-theme-hint">{session.chatType === 2 ? '群聊' : '私聊'}</div>
            </div>
          </div>
          {session.chatType === 2 && onShowMembers && (
            <button onClick={onShowMembers} className="p-2 text-theme-muted hover:text-theme hover:bg-theme-item rounded-lg" title="查看群成员">
              <Users size={20} />
            </button>
          )}
        </div>

        <div ref={parentRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4">
          <div ref={topSentinelRef} className="h-1" />
          {loadingMore && <div className="flex justify-center py-2"><Loader2 size={20} className="animate-spin text-pink-500" /></div>}
          {loading ? (
            <div className="flex items-center justify-center h-full"><Loader2 size={32} className="animate-spin text-pink-500" /></div>
          ) : allItems.length === 0 ? (
            <div className="flex items-center justify-center h-full text-theme-hint">暂无消息</div>
          ) : (
            <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative', opacity: isScrollReady ? 1 : 0 }}>
              {virtualizer.getVirtualItems().map(virtualRow => {
                const item = allItems[virtualRow.index]
                return (
                  <div key={virtualRow.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)`, padding: '8px 0' }} data-index={virtualRow.index} ref={virtualizer.measureElement}>
                    {item.type === 'raw' ? (
                      <RawMessageBubble message={item.data} allMessages={messages} isHighlighted={highlightMsgId === item.data.msgId} />
                    ) : (
                      <TempMessageBubble message={item.data} onRetry={() => handleRetryTemp(item.data)} />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {imagePreview && (
          <div className="px-4 py-2 border-t border-theme-divider bg-theme-item">
            <div className="relative inline-block">
              <img src={imagePreview.url} alt="预览" className="max-h-32 rounded-lg" />
              <button onClick={() => { URL.revokeObjectURL(imagePreview.url); setImagePreview(null) }} className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"><X size={14} /></button>
            </div>
          </div>
        )}

        {replyTo && (
          <div className="px-4 py-2 border-t border-theme-divider bg-theme-item">
            <div className="flex items-center gap-2">
              <Reply size={16} className="text-pink-500 flex-shrink-0" />
              <div className="flex-1 min-w-0 text-sm text-theme-secondary truncate">
                回复 {replyTo.sendMemberName || replyTo.sendNickName || replyTo.senderUin}：
                {replyTo.elements?.filter(el => !el.replyElement).map((el, i) => {
                  if (el.textElement) return <span key={i}>{el.textElement.content}</span>
                  if (el.picElement) return <span key={i}>[图片]</span>
                  return null
                })}
              </div>
              <button onClick={() => setReplyTo(null)} className="p-1 text-theme-hint hover:text-theme rounded"><X size={16} /></button>
            </div>
          </div>
        )}

        <div className="px-4 py-3 border-t border-theme-divider bg-theme-card">
          <div className="flex items-center gap-2">
            <input type="file" ref={fileInputRef} onChange={handleImageSelect} accept="image/jpeg,image/png,image/gif" className="hidden" />
            <div className="flex-1">
              <textarea ref={textareaRef} value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="输入消息..." disabled={sending} rows={1} className="w-full px-4 py-2.5 bg-theme-input border border-theme-input rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-pink-500/20 disabled:opacity-50 text-theme placeholder:text-theme-hint" style={{ minHeight: '42px', maxHeight: '120px' }} />
            </div>
            <button onClick={() => fileInputRef.current?.click()} disabled={sending} className="p-2.5 text-theme-muted hover:text-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/30 rounded-xl disabled:opacity-50" title="发送图片">
              <ImageIcon size={20} />
            </button>
            <button onClick={imagePreview ? handleSendImage : handleSendText} disabled={sending || (!imagePreview && isEmptyMessage(inputText))} className="p-2.5 bg-pink-500 text-white rounded-xl hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed">
              {sending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* 消息右键菜单 */}
      {contextMenu && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null) }} />
          <div className="fixed z-50 bg-popup backdrop-blur-sm border border-theme-divider rounded-lg shadow-lg py-1 min-w-[100px]" style={{ left: contextMenu.x, top: Math.min(contextMenu.y, window.innerHeight - 120) }} onContextMenu={(e) => e.preventDefault()}>
            <button onClick={() => { setReplyTo(contextMenu.message); setContextMenu(null); textareaRef.current?.focus() }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-theme hover:bg-theme-item-hover transition-colors">
              <Reply size={14} />
              回复
            </button>
            {(() => {
              const msg = contextMenu.message
              const selfUid = getSelfUid()
              const isSelfMessage = selfUid && msg.senderUid === selfUid
              const isGroup = msg.chatType === 2
              const cachedMembers = isGroup && session ? getCachedMembers(session.peerId) : null
              const selfMember = cachedMembers && selfUid ? cachedMembers.find((m) => m.uid === selfUid) : null
              const selfRole = selfMember?.role
              const isOwner = selfRole === 'owner'
              const isAdmin = selfRole === 'admin' || selfRole === 'owner'
              const targetMember = cachedMembers ? cachedMembers.find((m) => m.uid === msg.senderUid) : null
              const targetRole = targetMember?.role
              const targetIsAdmin = targetRole === 'admin' || targetRole === 'owner'
              const canRecall = isSelfMessage || (isGroup && (isOwner || (isAdmin && !targetIsAdmin)))
              if (!canRecall) return null
              return (
                <button onClick={async () => {
                  setContextMenu(null)
                  try {
                    await recallMessage(msg.chatType, msg.peerUid, msg.msgId)
                    setMessages(prev => prev.filter(m => m.msgId !== msg.msgId))
                    if (session) {
                      const sessionKey = `${session.chatType}_${session.peerId}`
                      const cached = messageCacheRef.current.get(sessionKey)
                      if (cached) messageCacheRef.current.set(sessionKey, cached.filter(m => m.msgId !== msg.msgId))
                      removeCachedMessage(session.chatType, session.peerId, msg.msgId)
                    }
                    showToast('消息已撤回', 'success')
                  } catch (e: any) {
                    showToast(e.message || '撤回失败', 'error')
                  }
                }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-theme-item-hover transition-colors">
                  <Trash2 size={14} />
                  撤回
                </button>
              )
            })()}
          </div>
        </>,
        document.body
      )}
      
      {/* 头像右键菜单 */}
      {avatarContextMenu && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAvatarContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setAvatarContextMenu(null) }} />
          <div className="fixed z-50 bg-popup backdrop-blur-sm border border-theme-divider rounded-lg shadow-lg py-1 min-w-[120px]" style={{ left: avatarContextMenu.x, top: Math.min(avatarContextMenu.y, window.innerHeight - 150) }} onContextMenu={(e) => e.preventDefault()}>
            {avatarContextMenu.chatType === 2 && (
              <button onClick={() => { setInputText(prev => prev + `@${avatarContextMenu.senderName} `); setAvatarContextMenu(null); textareaRef.current?.focus() }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-theme hover:bg-theme-item-hover transition-colors">
                <AtSign size={14} />
                @ta
              </button>
            )}
            <button onClick={async () => {
              const info = avatarContextMenu
              setAvatarContextMenu(null)
              try {
                if (info.chatType === 2 && info.groupCode) await sendPoke(info.chatType, parseInt(info.senderUin), parseInt(info.groupCode))
                else await sendPoke(info.chatType, parseInt(info.senderUin))
                showToast('戳一戳已发送', 'success')
              } catch (e: any) {
                showToast(e.message || '戳一戳失败', 'error')
              }
            }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-theme hover:bg-theme-item-hover transition-colors">
              <Hand size={14} />
              戳一戳
            </button>
            <button onClick={() => { handleShowProfile(avatarContextMenu.senderUid, avatarContextMenu.senderUin, avatarContextMenu.x, avatarContextMenu.y, avatarContextMenu.groupCode); setAvatarContextMenu(null) }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-theme hover:bg-theme-item-hover transition-colors">
              <User size={14} />
              查看资料
            </button>
            {/* 踢出群 - 权限逻辑：群主可踢任何人（除自己），管理员可踢普通成员（除群主、管理员、自己） */}
            {(() => {
              if (avatarContextMenu.chatType !== 2 || !avatarContextMenu.groupCode) return null
              const selfUid = getSelfUid()
              if (avatarContextMenu.senderUid === selfUid) return null // 不能踢自己
              const cachedMembers = getCachedMembers(avatarContextMenu.groupCode)
              const selfMember = cachedMembers && selfUid ? cachedMembers.find(m => m.uid === selfUid) : null
              const selfRole = selfMember?.role
              const isOwner = selfRole === 'owner'
              const isAdmin = selfRole === 'admin'
              const targetMember = cachedMembers ? cachedMembers.find(m => m.uid === avatarContextMenu.senderUid) : null
              const targetRole = targetMember?.role
              // 群主可以踢任何人（除自己），管理员只能踢普通成员
              const canKick = isOwner || (isAdmin && targetRole === 'member')
              if (!canKick) return null
              return (
                <button onClick={() => {
                  setKickConfirm({
                    uid: avatarContextMenu.senderUid,
                    name: avatarContextMenu.senderName,
                    groupCode: avatarContextMenu.groupCode!,
                    groupName: session?.peerName || avatarContextMenu.groupCode!
                  })
                  setAvatarContextMenu(null)
                }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-theme-item-hover transition-colors">
                  <UserMinus size={14} />
                  踢出群
                </button>
              )
            })()}
          </div>
        </>,
        document.body
      )}
      
      {/* 用户资料卡 */}
      {userProfile && (
        <UserProfileCard profile={userProfile.profile} loading={userProfile.loading} position={userProfile.position} onClose={() => setUserProfile(null)} />
      )}
      
      {/* 踢出群确认对话框 */}
      {kickConfirm && createPortal(
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setKickConfirm(null)} />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-theme-card border border-theme-divider rounded-xl shadow-xl p-6 min-w-[320px]">
            <h3 className="text-lg font-medium text-theme mb-4">确认踢出</h3>
            <p className="text-theme-secondary mb-6">
              确定要将 <span className="font-medium text-theme">{kickConfirm.name}</span> 移出群 <span className="font-medium text-theme">{kickConfirm.groupName}</span> 吗？
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setKickConfirm(null)} className="px-4 py-2 text-sm text-theme-secondary hover:bg-theme-item rounded-lg transition-colors">
                取消
              </button>
              <button onClick={async () => {
                const { uid, name, groupCode } = kickConfirm
                setKickConfirm(null)
                try {
                  await kickGroupMember(groupCode, uid)
                  showToast(`已将 ${name} 移出群聊`, 'success')
                } catch (e: any) {
                  showToast(e.message || '踢出失败', 'error')
                }
              }} className="px-4 py-2 text-sm bg-red-500 text-white hover:bg-red-600 rounded-lg transition-colors">
                确认踢出
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
      
      <ImagePreviewModal url={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      <VideoPreviewModal videoInfo={previewVideoUrl} onClose={() => setPreviewVideoUrl(null)} />
    </GroupMembersContext.Provider>
    </ScrollToMessageContext.Provider>
    </AvatarContextMenuContext.Provider>
    </MessageContextMenuContext.Provider>
    </VideoPreviewContext.Provider>
    </ImagePreviewContext.Provider>
  )
}

export default ChatWindow
