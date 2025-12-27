import React from 'react'
import { createPortal } from 'react-dom'
import type { RawMessage } from '../../../types/webqq'
import { ntCall } from '../../../utils/webqqApi'
import { showToast } from '../../common'
import { EmojiPicker } from './EmojiPicker'

interface EmojiReactionPickerProps {
  target: { message: RawMessage; x: number; y: number }
  onClose: () => void
  onReactionAdded: (msgId: string, emojiId: string, emojiType: string) => void
  containerRef?: React.RefObject<HTMLDivElement>
}

export const EmojiReactionPicker: React.FC<EmojiReactionPickerProps> = ({ target, onClose, onReactionAdded, containerRef }) => {
  const handleSelect = async (faceId: number) => {
    const msg = target.message
    onClose()
    try {
      const peer = { chatType: msg.chatType, peerUid: msg.peerUin, guildId: '' }
      await ntCall('ntMsgApi', 'setEmojiLike', [peer, msg.msgSeq, String(faceId), true])
      onReactionAdded(msg.msgId, String(faceId), faceId > 999 ? '2' : '1')
      showToast('已贴表情', 'success')
    } catch (e: any) {
      showToast(e.message || '贴表情失败', 'error')
    }
  }

  // 计算聊天窗口中央位置
  const getPosition = () => {
    if (containerRef?.current) {
      const rect = containerRef.current.getBoundingClientRect()
      return {
        left: rect.left + rect.width / 2,
        top: rect.top + rect.height / 2
      }
    }
    // 降级到屏幕中央
    return {
      left: window.innerWidth / 2,
      top: window.innerHeight / 2
    }
  }

  const pos = getPosition()

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div 
        className="fixed z-50 -translate-x-1/2 -translate-y-1/2"
        style={{ left: pos.left, top: pos.top }}
      >
        <EmojiPicker onSelect={handleSelect} onClose={onClose} inline />
      </div>
    </>,
    document.body
  )
}

export default EmojiReactionPicker
