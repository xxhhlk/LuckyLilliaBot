import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Terminal, Trash2, Pause, Play, ArrowDown } from 'lucide-react'
import { getCookie } from '../utils/cookie'

interface LogRecord {
  timestamp: number
  type: string
  content: string
  dateTimeStr: string
}

const LOG_ITEM_HEIGHT = 72 // 预估每条日志高度
const MAX_LOGS = 1000
const BUFFER_SIZE = 10 // 上下缓冲区条数

const LogViewer: React.FC = () => {
  const [logs, setLogs] = useState<LogRecord[]>([])
  const [isPaused, setIsPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [connected, setConnected] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const pausedLogsRef = useRef<LogRecord[]>([])

  const scrollToBottom = useCallback(() => {
    if (containerRef.current && autoScroll) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [autoScroll])

  useEffect(() => {
    let es: EventSource | null = null
    let mounted = true

    const connect = () => {
      const token = getCookie('webui_token') || ''
      const url = `/api/logs/stream?token=${encodeURIComponent(token)}`
      es = new EventSource(url)

      // 监听连接确认事件
      es.addEventListener('connected', () => {
        if (mounted) setConnected(true)
      })

      es.onmessage = (event) => {
        if (!mounted) return
        try {
          const record: LogRecord = JSON.parse(event.data)
          if (isPaused) {
            pausedLogsRef.current.push(record)
          } else {
            setLogs(prev => {
              const newLogs = [...prev, record]
              if (newLogs.length > MAX_LOGS) {
                return newLogs.slice(-MAX_LOGS)
              }
              return newLogs
            })
          }
        } catch (e) {
          console.error('[LogViewer] Failed to parse log:', e)
        }
      }

      es.onerror = () => {
        if (mounted) setConnected(false)
      }
    }

    connect()

    return () => {
      mounted = false
      if (es) es.close()
    }
  }, [isPaused])

  useEffect(() => {
    scrollToBottom()
  }, [logs, scrollToBottom])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const handleResume = () => {
    setIsPaused(false)
    setLogs(prev => {
      const newLogs = [...prev, ...pausedLogsRef.current]
      pausedLogsRef.current = []
      return newLogs.length > MAX_LOGS ? newLogs.slice(-MAX_LOGS) : newLogs
    })
  }

  const handleClear = () => {
    setLogs([])
    pausedLogsRef.current = []
  }

  const getLogStyle = (type: string) => {
    switch (type.toLowerCase()) {
      case 'error':
        return {
          bg: 'bg-red-50/50',
          badge: 'text-red-600 bg-red-100/70',
        }
      case 'warn':
        return {
          bg: 'bg-amber-50/50',
          badge: 'text-amber-600 bg-amber-100/70',
        }
      case 'info':
        return {
          bg: 'bg-blue-50/50',
          badge: 'text-pink-500 bg-pink-100/70',
        }
      case 'debug':
        return {
          bg: 'bg-gray-50/50',
          badge: 'text-gray-500 bg-gray-100/70',
        }
      default:
        return {
          bg: 'bg-green-50/50',
          badge: 'text-green-600 bg-green-100/70',
        }
    }
  }

  const filteredLogs = useMemo(() => {
    let result = logs
    // 等级筛选
    if (levelFilter !== 'all') {
      result = result.filter(log => log.type.toLowerCase() === levelFilter)
    }
    // 文本搜索
    if (filter) {
      const lowerFilter = filter.toLowerCase()
      result = result.filter(log =>
        log.content.toLowerCase().includes(lowerFilter) ||
        log.type.toLowerCase().includes(lowerFilter)
      )
    }
    return result
  }, [logs, filter, levelFilter])

  // 虚拟滚动计算
  const containerHeight = containerRef.current?.clientHeight || 500
  const totalHeight = filteredLogs.length * LOG_ITEM_HEIGHT
  const startIndex = Math.max(0, Math.floor(scrollTop / LOG_ITEM_HEIGHT) - BUFFER_SIZE)
  const endIndex = Math.min(filteredLogs.length, Math.ceil((scrollTop + containerHeight) / LOG_ITEM_HEIGHT) + BUFFER_SIZE)
  const visibleLogs = filteredLogs.slice(startIndex, endIndex)
  const offsetY = startIndex * LOG_ITEM_HEIGHT

  return (
    <div className="space-y-4">
      {/* 头部卡片 */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md">
              <Terminal size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-800">实时日志</h3>
              <div className="flex items-center gap-2 text-xs">
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${connected ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
                  {connected ? '已连接' : '未连接'}
                </span>
                <span className="text-gray-500">
                  {isPaused ? `已暂停 (${pausedLogsRef.current.length} 条待显示)` : `${logs.length} 条日志`}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              {[
                { value: 'all', label: '全部' },
                { value: 'info', label: 'Info' },
                { value: 'warn', label: 'Warn' },
                { value: 'error', label: 'Error' },
              ].map((item) => (
                <button
                  key={item.value}
                  onClick={() => setLevelFilter(item.value)}
                  className={`px-3 py-1.5 text-xs font-medium transition-all ${
                    levelFilter === item.value
                      ? 'gradient-primary-br text-white'
                      : 'bg-white/50 text-gray-600 hover:bg-white/80'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="搜索日志..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="px-3 py-1.5 text-sm bg-white/50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent w-40"
            />
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`p-2 rounded-lg transition-all ${autoScroll ? 'gradient-primary text-white shadow-md' : 'bg-white/50 text-gray-600 hover:bg-white/80'}`}
              title={autoScroll ? '自动滚动已开启' : '自动滚动已关闭'}
            >
              <ArrowDown size={18} />
            </button>
            <button
              onClick={isPaused ? handleResume : () => setIsPaused(true)}
              className={`p-2 rounded-lg transition-all ${isPaused ? 'bg-gradient-to-br from-green-500 to-emerald-500 text-white shadow-md' : 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md'}`}
              title={isPaused ? '继续' : '暂停'}
            >
              {isPaused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            <button
              onClick={handleClear}
              className="p-2 bg-gradient-to-br from-red-500 to-pink-500 text-white rounded-lg shadow-md hover:shadow-lg transition-all"
              title="清空日志"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* 日志列表 - 虚拟滚动 */}
      <div className="card p-4">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-[calc(100vh-240px)] overflow-auto pr-2"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Terminal size={48} className="mb-3 opacity-50" />
              <p className="text-sm">等待日志...</p>
            </div>
          ) : (
            <div style={{ height: totalHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${offsetY}px)` }} className="space-y-1.5">
                {visibleLogs.map((log, index) => {
                  const style = getLogStyle(log.type)
                  return (
                    <div
                      key={`${log.timestamp}-${startIndex + index}`}
                      className={`p-2.5 rounded-lg ${style.bg} hover:shadow-sm transition-shadow`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs text-gray-400 font-mono">{log.dateTimeStr}</span>
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${style.badge}`}>
                              {log.type.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap break-all font-mono">
                            {log.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LogViewer
