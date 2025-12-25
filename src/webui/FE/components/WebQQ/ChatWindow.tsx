import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Users, Send, Image as ImageIcon, X, Loader2, AlertCircle, RefreshCw, Reply, Trash2 } from 'lucide-react'
import type { ChatSession, RawMessage, MessageElement } from '../../types/webqq'
import { getMessages, sendMessage, uploadImage, formatMessageTime, isEmptyMessage, isValidImageFormat, getSelfUid, getSelfUin, getUserDisplayName, getVideoUrl, recallMessage } from '../../utils/webqqApi'
import { useWebQQStore, hasVisitedChat, markChatVisited } from '../../stores/webqqStore'
import { getCachedMessages, setCachedMessages, appendCachedMessage, removeCachedMessage } from '../../utils/messageDb'
import { getToken } from '../../utils/api'
import { showToast } from '../Toast'

interface TempMessage {
  msgId: string
  text?: string
  imageUrl?: string
  timestamp: number
  status: 'sending' | 'sent' | 'failed'
}

interface ChatWindowProps {
  session: ChatSession | null
  onShowMembers?: () => void
  onNewMessageCallback?: (callback: ((msg: RawMessage) => void) | null) => void
}

const getProxyImageUrl = (url: string | undefined): string => {
  if (!url) return ''
  if (url.startsWith('blob:')) return url
  if (url.includes('qpic.cn') || url.includes('multimedia.nt.qq.com.cn')) {
    return `/api/webqq/image-proxy?url=${encodeURIComponent(url)}&token=${encodeURIComponent(getToken() || '')}`
  }
  return url
}

// 图片预览上下文
const ImagePreviewContext = React.createContext<{
  showPreview: (url: string) => void
} | null>(null)

// 视频预览上下文
const VideoPreviewContext = React.createContext<{
  showPreview: (chatType: number, peerUid: string, msgId: string, elementId: string) => void
} | null>(null)

// 消息右键菜单上下文
const MessageContextMenuContext = React.createContext<{
  showMenu: (e: React.MouseEvent, message: RawMessage) => void
} | null>(null)

// 跳转到消息上下文
const ScrollToMessageContext = React.createContext<{
  scrollToMessage: (msgId: string, msgSeq?: string) => void
} | null>(null)

// 图片预览弹窗组件
const ImagePreviewModal: React.FC<{ url: string | null; onClose: () => void }> = ({ url, onClose }) => {
  if (!url) return null
  
  return createPortal(
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <button 
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-white/80 hover:text-white bg-black/50 rounded-full"
      >
        <X size={24} />
      </button>
      <img 
        src={url} 
        alt="预览" 
        className="max-w-[90vw] max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  )
}

// 视频预览弹窗组件
const VideoPreviewModal: React.FC<{ 
  videoInfo: { chatType: number; peerUid: string; msgId: string; elementId: string } | null
  onClose: () => void 
}> = ({ videoInfo, onClose }) => {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    if (!videoInfo) {
      setUrl(null)
      setError(null)
      return
    }
    
    setLoading(true)
    setError(null)
    getVideoUrl(videoInfo.chatType, videoInfo.peerUid, videoInfo.msgId, videoInfo.elementId)
      .then(setUrl)
      .catch(e => setError(e.message || '获取视频失败'))
      .finally(() => setLoading(false))
  }, [videoInfo])
  
  if (!videoInfo) return null
  
  return createPortal(
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <button 
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-white/80 hover:text-white bg-black/50 rounded-full z-10"
      >
        <X size={24} />
      </button>
      {loading && (
        <div className="text-white flex items-center gap-2">
          <Loader2 size={24} className="animate-spin" />
          加载中...
        </div>
      )}
      {error && (
        <div className="text-red-400">{error}</div>
      )}
      {url && !loading && (
        <video 
          src={url} 
          controls
          autoPlay
          className="max-w-[90vw] max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>,
    document.body
  )
}

const MessageElementRenderer = memo<{ element: MessageElement; message?: RawMessage }>(({ element, message }) => {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [videoThumbLoaded, setVideoThumbLoaded] = useState(false)
  const [videoThumbError, setVideoThumbError] = useState(false)
  const previewContext = React.useContext(ImagePreviewContext)
  const videoPreviewContext = React.useContext(VideoPreviewContext)
  
  if (element.textElement) return <span className="whitespace-pre-wrap break-words">{element.textElement.content}</span>
  if (element.picElement) {
    const pic = element.picElement
    let url = pic.originImageUrl ? (pic.originImageUrl.startsWith('http') ? pic.originImageUrl : `https://gchat.qpic.cn${pic.originImageUrl}`) : ''
    const proxyUrl = getProxyImageUrl(url)
    
    // 计算显示尺寸，保持比例，最大高度200px，最大宽度100%
    const maxHeight = 200
    const maxWidth = 300
    let displayWidth = pic.picWidth || 200
    let displayHeight = pic.picHeight || 200
    
    if (displayHeight > maxHeight) {
      displayWidth = (displayWidth * maxHeight) / displayHeight
      displayHeight = maxHeight
    }
    if (displayWidth > maxWidth) {
      displayHeight = (displayHeight * maxWidth) / displayWidth
      displayWidth = maxWidth
    }
    
    return (
      <div 
        className="relative rounded-lg overflow-hidden bg-theme-item cursor-pointer"
        style={{ width: displayWidth, height: displayHeight }}
        onClick={() => previewContext?.showPreview(proxyUrl)}
      >
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center text-theme-hint">
            <Loader2 size={24} className="animate-spin" />
          </div>
        )}
        {imageError && (
          <div className="absolute inset-0 flex items-center justify-center text-theme-hint text-xs">
            图片加载失败
          </div>
        )}
        <img 
          src={proxyUrl} 
          alt="图片" 
          loading="lazy" 
          className={`w-full h-full object-cover transition-opacity ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
        />
      </div>
    )
  }
  if (element.faceElement) return <span>[表情]</span>
  if (element.fileElement) return <span>[文件: {element.fileElement.fileName}]</span>
  if (element.pttElement) return <span>[语音消息]</span>
  if (element.videoElement) {
    const video = element.videoElement
    // 计算显示尺寸
    const maxHeight = 200
    const maxWidth = 300
    let displayWidth = video.thumbWidth || 200
    let displayHeight = video.thumbHeight || 150
    
    if (displayHeight > maxHeight) {
      displayWidth = (displayWidth * maxHeight) / displayHeight
      displayHeight = maxHeight
    }
    if (displayWidth > maxWidth) {
      displayHeight = (displayHeight * maxWidth) / displayWidth
      displayWidth = maxWidth
    }
    
    // 获取缩略图 URL（thumbPath 可能是 Map 或普通对象，通过代理访问）
    let thumbUrl = ''
    if (video.thumbPath) {
      let firstThumb: string | undefined
      if (video.thumbPath instanceof Map) {
        firstThumb = video.thumbPath.values().next().value
      } else if (typeof video.thumbPath === 'object') {
        // JSON 序列化后 Map 变成普通对象
        const values = Object.values(video.thumbPath as Record<string, string>)
        firstThumb = values[0]
      }
      if (firstThumb) {
        thumbUrl = `/api/webqq/file-proxy?path=${encodeURIComponent(firstThumb)}&token=${encodeURIComponent(getToken() || '')}`
      }
    }
    
    // 格式化时长
    const duration = video.fileTime || 0
    const minutes = Math.floor(duration / 60)
    const seconds = duration % 60
    const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
    
    // 点击播放视频
    const handleClick = () => {
      if (message && element.elementId) {
        videoPreviewContext?.showPreview(message.chatType, message.peerUid, message.msgId, element.elementId)
      }
    }
    
    return (
      <div 
        className="relative rounded-lg overflow-hidden bg-theme-item cursor-pointer group"
        style={{ width: displayWidth, height: displayHeight }}
        onClick={handleClick}
      >
        {/* 背景/占位 */}
        <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700" />
        
        {/* 缩略图 */}
        {thumbUrl ? (
          <>
            {!videoThumbLoaded && !videoThumbError && (
              <div className="absolute inset-0 flex items-center justify-center text-theme-hint">
                <Loader2 size={24} className="animate-spin" />
              </div>
            )}
            <img 
              src={thumbUrl} 
              alt="视频缩略图" 
              loading="lazy" 
              className={`absolute inset-0 w-full h-full object-cover transition-opacity ${videoThumbLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setVideoThumbLoaded(true)}
              onError={() => setVideoThumbError(true)}
            />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-theme-hint text-xs">
            视频
          </div>
        )}
        
        {/* 播放按钮 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center group-hover:bg-black/70 transition-colors">
            <div className="w-0 h-0 border-t-8 border-t-transparent border-l-12 border-l-white border-b-8 border-b-transparent ml-1" 
                 style={{ borderLeftWidth: '14px' }} />
          </div>
        </div>
        {/* 时长 */}
        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/60 rounded text-white text-xs">
          {durationStr}
        </div>
      </div>
    )
  }
  if (element.grayTipElement) {
    // 解析戳一戳等灰色提示
    const grayTip = element.grayTipElement
    if (grayTip.jsonGrayTipElement?.jsonStr) {
      try {
        const json = JSON.parse(grayTip.jsonGrayTipElement.jsonStr)
        // 戳一戳消息
        if (json.items) {
          const text = json.items.map((item: any) => item.txt || '').join('')
          return <span className="text-theme-hint text-xs">{text || '[戳一戳]'}</span>
        }
      } catch {
        // ignore
      }
    }
    return <span className="text-theme-hint text-xs">[系统提示]</span>
  }
  if (element.arkElement) return <span>[卡片消息]</span>
  if (element.marketFaceElement) return <span>[{element.marketFaceElement.faceName || '表情包'}]</span>
  // 未知类型，返回 null 不渲染
  return null
})

// 检查元素是否有有效内容
const hasValidContent = (element: MessageElement): boolean => {
  return !!(
    element.textElement ||
    element.picElement ||
    element.fileElement ||
    element.pttElement ||
    element.videoElement ||
    element.faceElement ||
    element.grayTipElement ||
    element.arkElement ||
    element.marketFaceElement
  )
}

// 检查消息是否是系统提示（如戳一戳）
const isSystemTipMessage = (message: RawMessage): boolean => {
  if (!message.elements || message.elements.length === 0) return false
  // 只有 grayTipElement 的消息是系统提示
  return message.elements.every(el => el.grayTipElement || el.replyElement)
}

// 解析戳一戳 JSON 中的 items，返回需要解析的 uid 列表
const parseGrayTipItems = (message: RawMessage): { items: any[]; hasUid: boolean } | null => {
  for (const el of message.elements) {
    if (el.grayTipElement?.jsonGrayTipElement?.jsonStr) {
      try {
        const json = JSON.parse(el.grayTipElement.jsonGrayTipElement.jsonStr)
        if (json.items) {
          const hasUid = json.items.some((item: any) => item.type === 'qq' && item.uid)
          return { items: json.items, hasUid }
        }
      } catch {
        // ignore
      }
    }
  }
  return null
}

// 系统提示消息内容缓存（按 msgId 缓存已解析的内容）
const systemTipContentCache = new Map<string, React.ReactNode>()

// 系统提示消息组件（居中显示）
const SystemTipMessage = memo<{ message: RawMessage; groupCode?: string }>(({ message, groupCode }) => {
  // 先检查缓存
  const cachedContent = systemTipContentCache.get(message.msgId)
  const [content, setContent] = useState<React.ReactNode>(cachedContent ?? '[系统提示]')
  const selfUid = getSelfUid()
  
  useEffect(() => {
    // 如果已有缓存，直接使用
    if (systemTipContentCache.has(message.msgId)) {
      setContent(systemTipContentCache.get(message.msgId)!)
      return
    }
    
    const parsed = parseGrayTipItems(message)
    if (!parsed) {
      // 尝试解析 XML
      for (const el of message.elements) {
        if (el.grayTipElement?.xmlElement?.content) {
          const xmlContent = el.grayTipElement.xmlElement.content.replace(/<[^>]+>/g, '')
          systemTipContentCache.set(message.msgId, xmlContent)
          setContent(xmlContent)
          return
        }
      }
      systemTipContentCache.set(message.msgId, '[系统提示]')
      setContent('[系统提示]')
      return
    }
    
    const { items, hasUid } = parsed
    
    if (!hasUid) {
      // 没有 uid，直接拼接文本
      const result = items.map((item: any) => item.txt || '').join('')
      const finalContent = result || '[系统提示]'
      systemTipContentCache.set(message.msgId, finalContent)
      setContent(finalContent)
      return
    }
    
    // 有 uid，需要异步获取昵称
    const resolveContent = async () => {
      const parts: React.ReactNode[] = []
      let keyIndex = 0
      for (const item of items) {
        if (item.type === 'qq' && item.uid) {
          // 检查是否是自己
          if (item.uid === selfUid) {
            parts.push(<span key={keyIndex++} className="text-blue-500">你</span>)
          } else {
            const name = await getUserDisplayName(item.uid, groupCode)
            parts.push(<span key={keyIndex++} className="text-blue-500">{name}</span>)
          }
        } else if (item.type === 'nor' && item.txt) {
          parts.push(<span key={keyIndex++}>{item.txt}</span>)
        } else if (item.type === 'img') {
          // 图片类型，跳过
        }
      }
      const finalContent = parts.length > 0 ? parts : '[系统提示]'
      systemTipContentCache.set(message.msgId, finalContent)
      setContent(finalContent)
    }
    
    resolveContent()
  }, [message.msgId, selfUid, groupCode])
  
  return (
    <div className="flex justify-center py-2">
      <span className="text-xs text-theme-hint bg-theme-item/50 px-3 py-1 rounded-full">
        {content}
      </span>
    </div>
  )
})

const RawMessageBubble = memo<{ message: RawMessage; allMessages: RawMessage[]; isHighlighted?: boolean }>(({ message, allMessages, isHighlighted }) => {
  // 如果是系统提示消息，使用不同的渲染方式
  if (isSystemTipMessage(message)) {
    // 群聊时传入群号
    const groupCode = message.chatType === 2 ? message.peerUin : undefined
    return <SystemTipMessage message={message} groupCode={groupCode} />
  }
  
  const selfUid = getSelfUid()
  const isSelf = selfUid ? message.senderUid === selfUid : false
  const senderName = message.sendMemberName || message.sendNickName || message.senderUin
  const senderAvatar = `https://q1.qlogo.cn/g?b=qq&nk=${message.senderUin}&s=640`
  const timestamp = parseInt(message.msgTime) * 1000
  const contextMenuContext = React.useContext(MessageContextMenuContext)
  const scrollToMessageContext = React.useContext(ScrollToMessageContext)
  
  if (!message.elements || !Array.isArray(message.elements)) return null

  // 分离 reply 元素和其他元素
  const replyElement = message.elements.find(el => el.replyElement)?.replyElement
  const otherElements = message.elements.filter(el => !el.replyElement)
  
  // 检查是否有有效内容，如果没有则不渲染
  const hasContent = otherElements.some(hasValidContent) || replyElement
  if (!hasContent) return null

  // 查找被引用的原消息
  const replySourceMsg = replyElement ? allMessages.find(m => m.msgId === replyElement.replayMsgId || m.msgSeq === replyElement.replayMsgSeq) : null

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    contextMenuContext?.showMenu(e, message)
  }

  const handleReplyClick = () => {
    if (replyElement) {
      scrollToMessageContext?.scrollToMessage(replyElement.replayMsgId, replyElement.replayMsgSeq)
    }
  }

  return (
    <div className={`flex gap-2 ${isSelf ? 'flex-row-reverse' : ''} ${isHighlighted ? 'animate-pulse bg-pink-100 dark:bg-pink-900/30 rounded-lg -mx-2 px-2' : ''}`} onContextMenu={handleContextMenu}>
      <img src={senderAvatar} alt={senderName} loading="lazy" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
      <div className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'} max-w-[70%]`}>
        <span className="text-xs text-theme-hint mb-1">{senderName}</span>
        <div className={`rounded-2xl px-4 py-2 min-w-[80px] break-all ${isSelf ? 'bg-pink-500 text-white rounded-br-sm' : 'bg-theme-item text-theme rounded-tl-sm shadow-sm'}`}>
          {replyElement && (
            <div 
              className={`text-xs mb-2 pb-2 border-b cursor-pointer hover:opacity-80 transition-opacity ${isSelf ? 'border-pink-400/50' : 'border-theme-divider'}`}
              onClick={handleReplyClick}
            >
              <div className={`${isSelf ? 'bg-pink-400/30' : 'bg-theme-input'} rounded px-2 py-1`}>
                {replySourceMsg ? (
                  <div className="space-y-1">
                    <div className={`font-medium ${isSelf ? 'text-pink-100' : 'text-theme-secondary'}`}>
                      {replySourceMsg.sendMemberName || replySourceMsg.sendNickName || replySourceMsg.senderUin}:
                    </div>
                    <div className={`${isSelf ? 'text-pink-100' : 'text-theme-muted'}`}>
                      {replySourceMsg.elements?.filter(el => !el.replyElement).map((el, i) => (
                        <MessageElementRenderer key={i} element={el} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className={`${isSelf ? 'text-pink-100' : 'text-theme-muted'}`}>
                    {replyElement.sourceMsgText || '[消息]'}
                  </span>
                )}
              </div>
            </div>
          )}
          {otherElements.map((element, index) => <MessageElementRenderer key={index} element={element} message={message} />)}
        </div>
        <span className="text-xs text-theme-hint mt-1">{formatMessageTime(timestamp)}</span>
      </div>
    </div>
  )
})

const TempMessageBubble = memo<{ message: TempMessage; onRetry: () => void }>(({ message, onRetry }) => {
  const selfUin = getSelfUin()
  const selfAvatar = selfUin ? `https://q1.qlogo.cn/g?b=qq&nk=${selfUin}&s=640` : ''
  
  return (
    <div className="flex gap-2 flex-row-reverse">
      {selfAvatar && <img src={selfAvatar} alt="我" loading="lazy" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />}
      <div className="flex flex-col items-end max-w-[70%]">
        <span className="text-xs text-theme-hint mb-1">我</span>
        <div className="flex items-end gap-1">
          {message.status === 'failed' && <button onClick={onRetry} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded" title="重新发送"><RefreshCw size={14} /></button>}
          <div className="rounded-2xl px-4 py-2 bg-pink-500 text-white rounded-br-sm min-w-[80px] break-all">
            {message.text && <span className="whitespace-pre-wrap break-words">{message.text}</span>}
            {message.imageUrl && <img src={message.imageUrl} alt="图片" loading="lazy" className="max-w-full rounded-lg" style={{ maxHeight: '200px' }} />}
          </div>
          {message.status === 'sending' && <Loader2 size={14} className="animate-spin text-theme-hint" />}
          {message.status === 'failed' && <AlertCircle size={14} className="text-red-500" />}
        </div>
        <span className="text-xs text-theme-hint mt-1">{formatMessageTime(message.timestamp)}</span>
      </div>
    </div>
  )
})

// 虚拟列表消息项
type MessageItem = { type: 'raw'; data: RawMessage } | { type: 'temp'; data: TempMessage }

const ChatWindow: React.FC<ChatWindowProps> = ({ session, onShowMembers, onNewMessageCallback }) => {
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
  const [isScrollReady, setIsScrollReady] = useState(false)
  
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
  
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null)
  
  const { getCachedMembers, setCachedMembers } = useWebQQStore()
  
  const parentRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sessionRef = useRef(session)
  const shouldScrollRef = useRef(true)
  const prevSessionKeyRef = useRef<string | null>(null)
  const allItemsRef = useRef<MessageItem[]>([])
  
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  // 合并消息列表
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

  // 虚拟列表
  const virtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  })

  // 跳转到指定消息
  const scrollToMessage = useCallback((msgId: string, msgSeq?: string) => {
    const index = allItems.findIndex(item => {
      if (item.type !== 'raw') return false
      return item.data.msgId === msgId || (msgSeq && item.data.msgSeq === msgSeq)
    })
    if (index !== -1) {
      virtualizer.scrollToIndex(index, { align: 'center' })
      // 高亮显示目标消息
      const targetMsg = allItems[index]
      if (targetMsg.type === 'raw') {
        setHighlightMsgId(targetMsg.data.msgId)
        setTimeout(() => setHighlightMsgId(null), 2000)
      }
    }
  }, [allItems, virtualizer])

  const scrollToMessageContextValue = useMemo(() => ({
    scrollToMessage
  }), [scrollToMessage])

  const scrollToBottom = useCallback(() => {
    if (allItemsRef.current.length > 0) {
      virtualizer.scrollToIndex(allItemsRef.current.length - 1, { align: 'end' })
    }
  }, [virtualizer])

  // 切换聊天时滚动到底部
  useEffect(() => {
    if (allItems.length === 0) return
    
    const currentKey = session ? `${session.chatType}_${session.peerId}` : null
    const isNewSession = currentKey !== prevSessionKeyRef.current
    
    if (isNewSession && currentKey) {
      prevSessionKeyRef.current = currentKey
      setIsScrollReady(false)
      // 滚动到底部，延迟确保虚拟列表高度计算完成
      const scrollToEnd = () => {
        if (parentRef.current) {
          parentRef.current.scrollTop = parentRef.current.scrollHeight
        }
      }
      // 立即尝试一次
      scrollToEnd()
      // 延迟再试一次，确保虚拟列表渲染完成，然后显示内容
      setTimeout(() => {
        scrollToEnd()
        setIsScrollReady(true)
      }, 50)
    }
  }, [session?.chatType, session?.peerId, allItems.length])

  // 当 session 变化时重置状态
  useEffect(() => {
    prevSessionKeyRef.current = null
    setIsScrollReady(false)
  }, [session?.chatType, session?.peerId])

  // 新消息到达时，如果在底部则滚动
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
          if (currentSession) {
            appendCachedMessage(currentSession.chatType, currentSession.peerId, msg)
          }
          return newMessages
        })
        setTempMessages(prev => prev.filter(t => t.status !== 'sending'))
        shouldScrollRef.current = true
      }
      onNewMessageCallback(handleNewMessage)
    }
    return () => {
      if (onNewMessageCallback) onNewMessageCallback(null)
    }
  }, [onNewMessageCallback])

  const loadMessages = useCallback(async (beforeMsgId?: string) => {
    if (!session) return

    if (beforeMsgId) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }

    try {
      const result = await getMessages(session.chatType, session.peerId, beforeMsgId)
      const validMessages = result.messages.filter((msg): msg is RawMessage => 
        msg !== null && msg !== undefined && msg.elements && Array.isArray(msg.elements)
      )
      
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.msgId))
        const newMsgs = validMessages.filter(m => !existingIds.has(m.msgId))
        const merged = beforeMsgId ? [...newMsgs, ...prev] : [...prev, ...newMsgs]
        merged.sort((a, b) => parseInt(a.msgTime) - parseInt(b.msgTime))
        setCachedMessages(session.chatType, session.peerId, merged)
        return merged
      })
      setHasMore(result.hasMore)
    } catch (e: any) {
      if (!beforeMsgId) {
        showToast('加载消息失败', 'error')
      } else {
        showToast('加载更多消息失败', 'error')
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [session])

  // 内存缓存：存储每个聊天的消息，避免切换时闪烁
  const messageCacheRef = useRef<Map<string, RawMessage[]>>(new Map())
  
  const getSessionKey = (chatType: number | string, peerId: string) => `${chatType}_${peerId}`

  // 组件挂载标记，用于首次进入时加载消息
  const isFirstMountRef = useRef(true)
  
  useEffect(() => {
    if (session) {
      const sessionKey = getSessionKey(session.chatType, session.peerId)
      
      // 先从内存缓存读取，避免空白闪烁
      const cachedInMemory = messageCacheRef.current.get(sessionKey)
      if (cachedInMemory && cachedInMemory.length > 0) {
        setMessages(cachedInMemory)
      }
      
      // 总是从 IndexedDB 加载最新数据（SSE 消息会写入 IndexedDB）
      getCachedMessages(session.chatType, session.peerId).then(cachedMessages => {
        if (cachedMessages && cachedMessages.length > 0) {
          const validMessages = cachedMessages.filter(m => m.elements && Array.isArray(m.elements))
          if (validMessages.length > 0) {
            messageCacheRef.current.set(sessionKey, validMessages)
            setMessages(validMessages)
          }
        } else if (!cachedInMemory || cachedInMemory.length === 0) {
          setMessages([])
        }
      })
      
      setTempMessages([])
      shouldScrollRef.current = true
      
      // 首次挂载或首次访问该聊天时调用 messages 接口
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

  // 消息变化时同步到内存缓存
  useEffect(() => {
    if (session && messages.length > 0) {
      const sessionKey = getSessionKey(session.chatType, session.peerId)
      messageCacheRef.current.set(sessionKey, messages)
    }
  }, [messages, session?.chatType, session?.peerId])

  const handleScroll = useCallback(() => {
    const container = parentRef.current
    if (!container || loadingMore || messages.length === 0) return
    
    // 检查是否在底部附近
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    shouldScrollRef.current = isNearBottom
    
    // 加载更多历史消息
    if (hasMore && container.scrollTop < 50) {
      const firstMsgId = messages[0]?.msgId
      if (firstMsgId) loadMessages(firstMsgId)
    }
  }, [loadingMore, hasMore, messages, loadMessages])

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
      if (currentReplyTo) {
        content.push({ type: 'reply', msgId: currentReplyTo.msgId, msgSeq: currentReplyTo.msgSeq })
      }
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
        
        // 检查格式
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
    <ScrollToMessageContext.Provider value={scrollToMessageContextValue}>
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
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    padding: '8px 0',
                  }}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                >
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
          <div
            className="fixed z-50 bg-theme-card border border-theme-divider rounded-lg shadow-lg py-1 min-w-[100px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              onClick={() => { setReplyTo(contextMenu.message); setContextMenu(null); textareaRef.current?.focus() }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-theme hover:bg-theme-item-hover transition-colors"
            >
              <Reply size={14} />
              回复
            </button>
            {(() => {
              const msg = contextMenu.message
              const selfUid = getSelfUid()
              const isSelfMessage = selfUid && msg.senderUid === selfUid
              // 私聊只能撤回自己的消息，群聊可以撤回自己的或者群主/管理员撤回他人的
              const isGroup = msg.chatType === 2
              // 获取缓存的群成员信息判断自己是否是管理员
              const cachedMembers = isGroup && session ? getCachedMembers(session.peerId) : null
              const selfMember = cachedMembers && selfUid ? Object.values(cachedMembers).find((m: any) => m.uid === selfUid) : null
              const selfRole = selfMember ? Number(selfMember.role) : 0 // 3=管理员, 4=群主
              const isOwner = selfRole === 4
              const isAdmin = selfRole === 3 || selfRole === 4
              
              // 获取消息发送者的角色
              const targetMember = cachedMembers ? Object.values(cachedMembers).find((m: any) => m.uid === msg.senderUid) : null
              const targetRole = targetMember ? Number(targetMember.role) : 0
              const targetIsAdmin = targetRole === 3 || targetRole === 4
              
              // 判断是否可以撤回：
              // 1. 自己的消息可以撤回
              // 2. 群主可以撤回任何人的消息
              // 3. 管理员只能撤回普通成员的消息（不能撤回其他管理员或群主的）
              const canRecall = isSelfMessage || (isGroup && (isOwner || (isAdmin && !targetIsAdmin)))
              
              if (!canRecall) return null
              
              return (
                <button
                  onClick={async () => {
                    setContextMenu(null)
                    try {
                      const chatType = msg.chatType
                      await recallMessage(chatType, msg.peerUid, msg.msgId)
                      // 从消息列表中移除
                      setMessages(prev => prev.filter(m => m.msgId !== msg.msgId))
                      // 从内存缓存中移除
                      if (session) {
                        const sessionKey = `${session.chatType}_${session.peerId}`
                        const cached = messageCacheRef.current.get(sessionKey)
                        if (cached) {
                          messageCacheRef.current.set(sessionKey, cached.filter(m => m.msgId !== msg.msgId))
                        }
                        // 从 IndexedDB 中移除
                        removeCachedMessage(session.chatType, session.peerId, msg.msgId)
                      }
                      showToast('消息已撤回', 'success')
                    } catch (e: any) {
                      showToast(e.message || '撤回失败', 'error')
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-theme-item-hover transition-colors"
                >
                  <Trash2 size={14} />
                  撤回
                </button>
              )
            })()}
          </div>
        </>,
        document.body
      )}
      
      <ImagePreviewModal url={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      <VideoPreviewModal videoInfo={previewVideoUrl} onClose={() => setPreviewVideoUrl(null)} />
    </ScrollToMessageContext.Provider>
    </MessageContextMenuContext.Provider>
    </VideoPreviewContext.Provider>
    </ImagePreviewContext.Provider>
  )
}

export default ChatWindow
