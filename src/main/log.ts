import path from 'node:path'
import { Context, Logger } from 'cordis'
import { appendFile } from 'node:fs'
import { LOG_DIR } from '@/common/globalVars'
import { noop } from 'cosmokit'

interface Config {
  enable: boolean
  filename: string
}

export interface LogRecord {
  timestamp: number
  type: string
  content: string
  dateTimeStr: string
}

// 日志缓存
const LOG_CACHE_SIZE = 1000
const logCache: LogRecord[] = []

export function getLogCache(): LogRecord[] {
  return logCache
}

declare module 'cordis' {
  interface Events {
    'llob/log': (record: LogRecord) => void
  }
}

export default class Log {
  static name = 'logger'

  constructor(ctx: Context, cfg: Config) {
    Logger.targets.splice(0, Logger.targets.length)
    let enable = cfg.enable
    const file = path.join(LOG_DIR, cfg.filename)
    const target: Logger.Target = {
      colors: 0,
      record: (record: Logger.Record) => {
        const dateTime = new Date(record.timestamp)
        const dateTimeStr = `${dateTime.getFullYear()}-${(dateTime.getMonth() + 1).toString().padStart(2, '0')}-${dateTime.getDate().toString().padStart(2, '0')} ${dateTime.getHours().toString().padStart(2, '0')}:${dateTime.getMinutes().toString().padStart(2, '0')}:${dateTime.getSeconds().toString().padStart(2, '0')}`
        let content = `${dateTimeStr} | ${record.content}\n\n`
        console.log(content)

        const logRecord: LogRecord = {
          timestamp: record.timestamp,
          type: record.type,
          content: record.content,
          dateTimeStr,
        }

        // 缓存日志
        logCache.push(logRecord)
        if (logCache.length > LOG_CACHE_SIZE) {
          logCache.shift()
        }

        // 发送日志事件到 SSE
        ctx.parallel('llob/log', logRecord)

        if (!enable) {
          return
        }
        content = `[${record.type}] | ${content}`
        appendFile(file, content, noop)
      },
    }
    Logger.targets.push(target)
    ctx.on('llob/config-updated', input => {
      enable = input.log!
    })
  }
}
