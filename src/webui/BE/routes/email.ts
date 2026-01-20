import { Router, Request, Response } from 'express'
import { Context } from 'cordis'
import { getConfigUtil } from '@/common/config'
import { EmailConfig } from '@/common/types'
import { EmailConfigManager } from '@/common/emailConfig'
import { EmailService } from '@/common/emailService'

const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  enabled: false,
  smtp: {
    host: '',
    port: 587,
    secure: false,
    auth: {
      user: '',
      pass: '',
    },
  },
  from: '',
  to: '',
}

export function createEmailRoutes(ctx: Context): Router {
  const router = Router()

  // 获取邮件配置
  router.get('/config', async (_req: Request, res: Response) => {
    try {
      const config = getConfigUtil().getConfig()
      const emailConfig = config.email || DEFAULT_EMAIL_CONFIG
      
      // 隐藏密码
      const maskedConfig = {
        ...emailConfig,
        smtp: {
          ...emailConfig.smtp,
          auth: {
            ...emailConfig.smtp.auth,
            pass: emailConfig.smtp.auth.pass ? '********' : '',
          },
        },
      }
      
      res.json({
        success: true,
        data: maskedConfig,
      })
    } catch (error: any) {
      ctx.logger?.error('[EmailAPI] Failed to get email config:', error)
      res.status(500).json({
        success: false,
        message: error.message || '获取邮件配置失败',
      })
    }
  })

  // 保存邮件配置（已废弃，现在通过主配置保存）
  router.post('/config', async (req: Request, res: Response) => {
    try {
      const { config: emailConfig } = req.body as { config: EmailConfig }
      
      if (!emailConfig) {
        res.status(400).json({
          success: false,
          message: '邮件配置不能为空',
        })
        return
      }

      const mainConfig = getConfigUtil().getConfig()
      const currentEmailConfig = mainConfig.email || DEFAULT_EMAIL_CONFIG
      
      // 如果密码是掩码，使用当前密码
      if (emailConfig.smtp.auth.pass === '********' || emailConfig.smtp.auth.pass === '') {
        emailConfig.smtp.auth.pass = currentEmailConfig.smtp.auth.pass
      }
      
      mainConfig.email = emailConfig
      getConfigUtil().setConfig(mainConfig)
      
      ctx.parallel('llob/config-updated', mainConfig)
      
      res.json({
        success: true,
        message: '邮件配置保存成功',
      })
    } catch (error: any) {
      ctx.logger?.error('[EmailAPI] Failed to save email config:', error)
      res.status(500).json({
        success: false,
        message: error.message || '保存邮件配置失败',
      })
    }
  })

  // 发送测试邮件
  router.post('/test', async (req: Request, res: Response) => {
    try {
      const { config: testConfig } = req.body as { config?: EmailConfig }
      
      // 使用提供的配置或当前保存的配置
      let emailConfig: EmailConfig
      if (testConfig) {
        emailConfig = testConfig
      } else {
        const mainConfig = getConfigUtil().getConfig()
        emailConfig = mainConfig.email || DEFAULT_EMAIL_CONFIG
      }
      
      // 创建临时的配置管理器和邮件服务进行测试
      const tempConfigManager = new EmailConfigManager('', ctx.logger)
      tempConfigManager['config'] = emailConfig
      
      const validation = tempConfigManager.validateConfig(emailConfig)
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          message: validation.errors.join(', '),
        })
        return
      }
      
      const tempEmailService = new EmailService(tempConfigManager, ctx.logger)
      const result = await tempEmailService.sendTestEmail()
      
      if (result.success) {
        res.json({
          success: true,
          message: '测试邮件发送成功',
          messageId: result.messageId,
        })
      } else {
        res.status(400).json({
          success: false,
          message: result.error || '测试邮件发送失败',
        })
      }
    } catch (error: any) {
      ctx.logger?.error('[EmailAPI] Failed to send test email:', error)
      res.status(500).json({
        success: false,
        message: error.message || '测试邮件发送失败',
      })
    }
  })

  return router
}
