import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { EmailConfigManager } from './emailConfig.js'

export interface EmailOptions {
  subject: string
  html: string
  text?: string
}

export interface SendResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface BotInfo {
  uin: string
  uid: string
  nick: string
  timestamp: Date
}

export class EmailService {
  private configManager: EmailConfigManager
  private logger?: { info: (msg: string, ...args: any[]) => void; error: (msg: string, ...args: any[]) => void }

  constructor(configManager: EmailConfigManager, logger?: { info: (msg: string, ...args: any[]) => void; error: (msg: string, ...args: any[]) => void }) {
    this.configManager = configManager
    this.logger = logger
  }

  async sendEmail(options: EmailOptions): Promise<SendResult> {
    try {
      const config = this.configManager.getConfig()

      if (!config.enabled) {
        return {
          success: false,
          error: '邮件通知未启用',
        }
      }

      const validation = this.configManager.validateConfig(config)
      if (!validation.valid) {
        return {
          success: false,
          error: `配置无效：${validation.errors.join(', ')}`,
        }
      }

      const transporter = this.createTransporter()

      const info = await transporter.sendMail({
        from: config.from,
        to: config.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      })

      this.logger?.info('[EmailService] Email sent successfully:', info.messageId)

      return {
        success: true,
        messageId: info.messageId,
      }
    } catch (error: any) {
      const errorMessage = this.getErrorMessage(error)
      this.logger?.error('[EmailService] Failed to send email:', errorMessage)

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  async sendTestEmail(): Promise<SendResult> {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const options = this.formatTestEmail(timestamp)
    return this.sendEmail(options)
  }

  async sendOfflineNotification(botInfo: BotInfo, reason?: string): Promise<SendResult> {
    const options = this.formatOfflineEmail(botInfo, reason)
    return this.sendEmail(options)
  }

  private createTransporter(): Transporter {
    const config = this.configManager.getConfig()

    return nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.auth.user,
        pass: config.smtp.auth.pass,
      },
    })
  }

  private formatOfflineEmail(botInfo: BotInfo, reason?: string): EmailOptions {
    const timestamp = botInfo.timestamp.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const reasonText = reason || '未知原因'

    const subject = `【LLBot 告警】机器人 ${botInfo.uin} 已离线`

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
      background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
      padding: 40px 20px;
      line-height: 1.6;
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: white;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }
    .header { 
      background: linear-gradient(135deg, #ef4444 0%, #ec4899 100%);
      color: white; 
      padding: 40px 32px;
      text-align: center;
      position: relative;
    }
    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(circle at 30% 50%, rgba(255,255,255,0.1) 0%, transparent 50%);
    }
    .header-content {
      position: relative;
      z-index: 1;
    }
    .icon {
      font-size: 56px;
      margin-bottom: 16px;
      filter: drop-shadow(0 4px 6px rgba(0,0,0,0.1));
    }
    .header h2 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }
    .header p {
      font-size: 15px;
      opacity: 0.95;
      font-weight: 500;
    }
    .content { 
      padding: 36px 32px;
    }
    .info-card {
      background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      border: 1px solid rgba(0,0,0,0.05);
    }
    .info-item { 
      margin: 14px 0;
      display: flex;
      align-items: flex-start;
      padding: 8px 0;
    }
    .info-item:not(:last-child) {
      border-bottom: 1px solid rgba(0,0,0,0.06);
    }
    .label { 
      font-weight: 600;
      color: #374151;
      min-width: 90px;
      flex-shrink: 0;
      font-size: 14px;
    }
    .value {
      color: #6b7280;
      flex: 1;
      font-size: 14px;
      word-break: break-word;
    }
    .alert-message {
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      border-left: 4px solid #f59e0b;
      padding: 18px 20px;
      border-radius: 12px;
      color: #92400e;
      font-size: 14px;
      line-height: 1.6;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .footer {
      text-align: center;
      padding: 28px 24px;
      background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
      color: #9ca3af;
      font-size: 13px;
      border-top: 1px solid rgba(0,0,0,0.05);
    }
    .footer strong {
      background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-content">
        <div class="icon">⚠️</div>
        <h2>机器人离线告警</h2>
        <p>您的 LLBot 实例已离线</p>
      </div>
    </div>
    <div class="content">
      <div class="info-card">
        <div class="info-item">
          <span class="label">机器人账号</span>
          <span class="value">${botInfo.uin} (${botInfo.nick})</span>
        </div>
        <div class="info-item">
          <span class="label">离线时间</span>
          <span class="value">${timestamp}</span>
        </div>
        <div class="info-item">
          <span class="label">离线原因</span>
          <span class="value">${reasonText}</span>
        </div>
      </div>
      <div class="alert-message">
        💡 请检查机器人状态和日志以获取更多信息，确保服务正常运行。
      </div>
    </div>
    <div class="footer">
      Powered by <strong>LLBot</strong> · Lucky Lillia Bot
    </div>
  </div>
</body>
</html>
    `.trim()

    return { subject, html }
  }

  private formatTestEmail(timestamp: string): EmailOptions {
    const subject = '【LLBot】测试邮件'

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
      background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
      padding: 40px 20px;
      line-height: 1.6;
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: white;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }
    .header { 
      background: linear-gradient(135deg, #10b981 0%, #14b8a6 100%);
      color: white; 
      padding: 40px 32px;
      text-align: center;
      position: relative;
    }
    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(circle at 30% 50%, rgba(255,255,255,0.1) 0%, transparent 50%);
    }
    .header-content {
      position: relative;
      z-index: 1;
    }
    .icon {
      font-size: 56px;
      margin-bottom: 16px;
      filter: drop-shadow(0 4px 6px rgba(0,0,0,0.1));
    }
    .header h2 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }
    .header p {
      font-size: 15px;
      opacity: 0.95;
      font-weight: 500;
    }
    .content { 
      padding: 36px 32px;
    }
    .success-card {
      background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      text-align: center;
      border: 1px solid rgba(16, 185, 129, 0.2);
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .success-card p {
      color: #065f46;
      font-size: 17px;
      margin: 10px 0;
      font-weight: 500;
    }
    .success-card .subtitle {
      font-size: 14px;
      margin-top: 12px;
      opacity: 0.8;
      font-weight: 400;
    }
    .info-box {
      background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
      border-radius: 12px;
      padding: 20px;
      margin-top: 24px;
      border: 1px solid rgba(0,0,0,0.05);
    }
    .info-box .label {
      font-weight: 600;
      color: #374151;
      margin-bottom: 6px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .info-box .value {
      color: #6b7280;
      font-size: 15px;
    }
    .footer {
      text-align: center;
      padding: 28px 24px;
      background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
      color: #9ca3af;
      font-size: 13px;
      border-top: 1px solid rgba(0,0,0,0.05);
    }
    .footer strong {
      background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-content">
        <div class="icon">✅</div>
        <h2>测试邮件</h2>
        <p>LLBot 邮件通知系统</p>
      </div>
    </div>
    <div class="content">
      <div class="success-card">
        <p>🎉 恭喜！邮件配置测试成功</p>
        <p class="subtitle">如果您收到此邮件，说明您的邮件配置已正确设置。</p>
      </div>
      <div class="info-box">
        <div class="label">发送时间</div>
        <div class="value">${timestamp}</div>
      </div>
    </div>
    <div class="footer">
      Powered by <strong>LLBot</strong> · Lucky Lillia Bot
    </div>
  </div>
</body>
</html>
    `.trim()

    return { subject, html }
  }

  private getErrorMessage(error: any): string {
    const config = this.configManager.getConfig()

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return `无法连接到 SMTP 服务器：${config.smtp.host}:${config.smtp.port}`
    }

    if (error.code === 'EAUTH' || error.responseCode === 535) {
      return 'SMTP 认证失败，请检查用户名和密码'
    }

    if (error.code === 'ETIMEDOUT') {
      return '邮件发送超时，请检查网络连接'
    }

    if (error.responseCode === 550 || error.responseCode === 553) {
      return `收件人邮箱地址无效：${config.to}`
    }

    if (error.responseCode === 421 || error.responseCode === 450) {
      return '邮件发送频率超限，请稍后再试'
    }

    return error.message || '发生未知错误'
  }
}
