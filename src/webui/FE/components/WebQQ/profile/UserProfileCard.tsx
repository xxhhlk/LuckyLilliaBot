import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Star, Moon, Sun, Crown } from 'lucide-react'
import type { UserProfile } from '../../../utils/webqqApi'

interface UserProfileCardProps {
  profile: UserProfile | null
  loading: boolean
  position: { x: number; y: number }
  onClose: () => void
}

// QQ等级图标组件：4进制 - 4级=1星，16级=1月亮，64级=1太阳，256级=1皇冠，1024级=1金企鹅
const QQLevelIcons: React.FC<{ level: number }> = ({ level }) => {
  const stars = level % 4
  const moons = Math.floor(level / 4) % 4
  const suns = Math.floor(level / 16) % 4
  const crowns = Math.floor(level / 64) % 4
  const penguins = Math.floor(level / 256)
  
  const icons: React.ReactNode[] = []
  
  for (let i = 0; i < penguins; i++) {
    icons.push(<span key={`penguin-${i}`} className="text-amber-400 text-xs font-bold" title="金企鹅">🐧</span>)
  }
  for (let i = 0; i < crowns; i++) {
    icons.push(<Crown key={`crown-${i}`} size={14} className="text-amber-500" />)
  }
  for (let i = 0; i < suns; i++) {
    icons.push(<Sun key={`sun-${i}`} size={14} className="text-orange-400" />)
  }
  for (let i = 0; i < moons; i++) {
    icons.push(<Moon key={`moon-${i}`} size={14} className="text-blue-400" />)
  }
  for (let i = 0; i < stars; i++) {
    icons.push(<Star key={`star-${i}`} size={14} className="text-yellow-400 fill-yellow-400" />)
  }
  
  return <div className="flex items-center gap-0.5 flex-wrap">{icons}</div>
}

export const UserProfileCard: React.FC<UserProfileCardProps> = ({ profile, loading, position, onClose }) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const [adjustedPosition, setAdjustedPosition] = useState({ left: position.x, top: position.y })
  
  useEffect(() => {
    if (!cardRef.current) return
    
    const cardWidth = 320
    const cardHeight = cardRef.current.offsetHeight || 400
    let left = position.x
    let top = position.y
    
    if (left + cardWidth > window.innerWidth - 20) {
      left = window.innerWidth - cardWidth - 20
    }
    if (left < 20) left = 20
    if (top + cardHeight > window.innerHeight - 20) {
      top = window.innerHeight - cardHeight - 20
    }
    if (top < 20) top = 20
    
    setAdjustedPosition({ left, top })
  }, [position, profile, loading])
  
  if (!profile && !loading) return null
  
  const getSexText = (sex: number) => {
    if (sex === 1) return '男'
    if (sex === 2) return '女'
    return ''
  }
  
  const getQAge = (regTime?: number) => {
    if (!regTime) return ''
    const regDate = new Date(regTime * 1000)
    const now = new Date()
    const years = now.getFullYear() - regDate.getFullYear()
    const months = now.getMonth() - regDate.getMonth()
    const totalYears = years + (months < 0 ? -1 : 0)
    if (totalYears < 1) {
      const totalMonths = years * 12 + months
      return totalMonths > 0 ? `${totalMonths}个月` : '不足1个月'
    }
    return `${totalYears}年`
  }
  
  const getRoleText = (role?: 'owner' | 'admin' | 'member') => {
    if (role === 'owner') return '群主'
    if (role === 'admin') return '管理员'
    return ''
  }
  
  const getRoleBadgeClass = (role?: 'owner' | 'admin' | 'member') => {
    if (role === 'owner') return 'bg-amber-500 text-white'
    if (role === 'admin') return 'bg-green-500 text-white'
    return ''
  }
  
  const formatTime = (timestamp?: number) => {
    if (!timestamp) return ''
    return new Date(timestamp * 1000).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={cardRef}
        className="fixed z-50 border border-theme-divider rounded-xl shadow-xl overflow-hidden bg-popup backdrop-blur-sm"
        style={{ left: adjustedPosition.left, top: adjustedPosition.top, width: 320, maxHeight: 'calc(100vh - 40px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={24} className="animate-spin text-pink-500" />
          </div>
        ) : profile && (
          <>
            <div className="bg-gradient-to-r from-pink-400 to-amber-300 p-4">
              <div className="flex items-start gap-4">
                <img 
                  src={profile.avatar} 
                  alt={profile.nickname}
                  className="w-16 h-16 rounded-full border-3 border-white/80 object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0 text-white pt-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-lg truncate">{profile.nickname}</span>
                    {profile.groupRole && getRoleText(profile.groupRole) && (
                      <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${getRoleBadgeClass(profile.groupRole)}`}>
                        {getRoleText(profile.groupRole)}
                      </span>
                    )}
                  </div>
                  {profile.remark && profile.remark !== profile.nickname && (
                    <div className="text-white/80 text-sm truncate mb-1">备注: {profile.remark}</div>
                  )}
                  <div className="text-white/90 text-sm">{profile.uin}</div>
                  {profile.qid && (
                    <div className="text-white/70 text-xs mt-0.5">QID: {profile.qid}</div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 40px - 120px)' }}>
              {profile.signature && (
                <div className="text-theme-secondary text-sm mb-3 bg-theme-item/50 rounded-lg px-3 py-2 max-h-24 overflow-y-auto break-words">
                  {profile.signature}
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {getSexText(profile.sex) && (
                  <>
                    <span className="text-theme-hint">性别</span>
                    <span className="text-theme">{getSexText(profile.sex)}</span>
                  </>
                )}
                {profile.birthday && profile.birthday !== '0-0-0' && (
                  <>
                    <span className="text-theme-hint">生日</span>
                    <span className="text-theme">{profile.birthday}</span>
                  </>
                )}
                {getQAge(profile.regTime) && (
                  <>
                    <span className="text-theme-hint">Q龄</span>
                    <span className="text-theme">{getQAge(profile.regTime)}</span>
                  </>
                )}
                {profile.level > 0 && (
                  <>
                    <span className="text-theme-hint">等级</span>
                    <div className="flex items-center gap-2">
                      <span className="text-theme">Lv.{profile.level}</span>
                      <QQLevelIcons level={profile.level} />
                    </div>
                  </>
                )}
              </div>
              
              {(profile.groupCard || profile.groupTitle || profile.groupLevel) && (
                <>
                  <div className="border-t border-theme-divider my-3" />
                  <div className="text-xs text-theme-hint mb-2">群信息</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {profile.groupCard && (
                      <>
                        <span className="text-theme-hint">群名片</span>
                        <span className="text-theme truncate">{profile.groupCard}</span>
                      </>
                    )}
                    {profile.groupTitle && (
                      <>
                        <span className="text-theme-hint">群头衔</span>
                        <span className="text-pink-500">{profile.groupTitle}</span>
                      </>
                    )}
                    {profile.groupLevel !== undefined && profile.groupLevel > 0 && (
                      <>
                        <span className="text-theme-hint">群等级</span>
                        <span className="text-theme">Lv.{profile.groupLevel}</span>
                      </>
                    )}
                    {profile.joinTime && (
                      <>
                        <span className="text-theme-hint">入群时间</span>
                        <span className="text-theme">{formatTime(profile.joinTime)}</span>
                      </>
                    )}
                    {profile.lastSpeakTime && (
                      <>
                        <span className="text-theme-hint">最后发言</span>
                        <span className="text-theme">{formatTime(profile.lastSpeakTime)}</span>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>,
    document.body
  )
}

export default UserProfileCard
