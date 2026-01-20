import { Context, Service } from 'cordis'
import { EmailService, BotInfo } from './emailService.js'
import { EmailConfigManager } from './emailConfig.js'
import { KickedOffLineInfo } from '@/ntqqapi/types/index.js'
import { selfInfo } from '@/common/globalVars.js'
import { getConfigUtil } from '@/common/config.js'

declare module 'cordis' {
  interface Context {
    emailNotification: EmailNotificationService
  }
}

export class EmailNotificationService extends Service {
  private emailService: EmailService
  private configManager: EmailConfigManager
  private notificationSent: boolean = false
  private hasLoggedIn: boolean = false

  constructor(ctx: Context) {
    super(ctx, 'emailNotification', true)

    // 创建一个临时的配置管理器用于验证和邮件服务
    this.configManager = new EmailConfigManager('', ctx.logger)
    this.emailService = new EmailService(this.configManager, ctx.logger)

    this.initializeConfig()
    this.registerEventListeners()
  }

  private async initializeConfig() {
    try {
      // 从主配置中加载邮件配置
      const mainConfig = getConfigUtil().getConfig()
      if (mainConfig.email) {
        this.configManager['config'] = mainConfig.email
      }
      this.ctx.logger.info('[EmailNotification] Service initialized')
    } catch (error) {
      this.ctx.logger.error('[EmailNotification] Failed to initialize:', error)
    }
  }

  private registerEventListeners() {
    // 插件加载时就认为已经登录（因为插件是在登录后才加载的）
    this.hasLoggedIn = true
    this.ctx.logger.info('[EmailNotification] Service started after login')

    // 监听配置更新
    this.ctx.on('llob/config-updated', (config) => {
      if (config.email) {
        this.configManager['config'] = config.email
        this.ctx.logger.info('[EmailNotification] Config updated')
      }
    })

    // 监听 selfInfo.online 的变化来检测重新登录
    // 当 selfInfo.online 从 false 变为 true 时，说明重新登录了
    let wasOffline = false
    
    this.ctx.on('nt/kicked-offLine', (info: KickedOffLineInfo) => {
      wasOffline = true
      this.onOffline(info)
    })

    // 使用定时器检查 selfInfo.online 状态
    const checkLoginStatus = setInterval(() => {
      if (wasOffline && selfInfo.online) {
        // 从离线恢复到在线，重置通知标志
        this.ctx.logger.info('[EmailNotification] Bot reconnected, resetting notification flag')
        this.notificationSent = false
        wasOffline = false
      }
    }, 5000) // 每5秒检查一次

    // 清理定时器
    this.ctx.on('dispose', () => {
      clearInterval(checkLoginStatus)
    })
  }

  private onOffline(info: KickedOffLineInfo) {
    if (!this.hasLoggedIn) {
      this.ctx.logger.debug('[EmailNotification] Offline event before login, ignoring')
      return
    }

    if (this.notificationSent) {
      this.ctx.logger.debug('[EmailNotification] Notification already sent for this session')
      return
    }

    this.ctx.logger.info('[EmailNotification] Bot went offline, sending notification')
    this.sendOfflineNotification(info.tipsDesc || info.tipsTitle)
  }

  private async sendOfflineNotification(reason?: string) {
    try {
      const config = this.configManager.getConfig()

      if (!config.enabled) {
        this.ctx.logger.debug('[EmailNotification] Email notifications are disabled')
        return
      }

      const botInfo: BotInfo = {
        uin: selfInfo.uin,
        uid: selfInfo.uid,
        nick: selfInfo.nick,
        timestamp: new Date(),
      }

      const result = await this.emailService.sendOfflineNotification(botInfo, reason)

      if (result.success) {
        this.notificationSent = true
        this.ctx.logger.info('[EmailNotification] Offline notification sent successfully')
      } else {
        this.ctx.logger.error('[EmailNotification] Failed to send notification:', result.error)
      }
    } catch (error) {
      this.ctx.logger.error('[EmailNotification] Error sending notification:', error)
    }
  }

  getEmailService(): EmailService {
    return this.emailService
  }

  getConfigManager(): EmailConfigManager {
    return this.configManager
  }
}

export default EmailNotificationService
