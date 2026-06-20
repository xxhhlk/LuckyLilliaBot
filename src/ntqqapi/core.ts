import { unlink } from 'node:fs/promises'
import { Service, Context } from 'cordis'
import { ReceiveCmdS } from './hook'
import { Config as LLOBConfig } from '../common/types'
import {
  RawMessage,
  GroupNotify,
  FriendRequestNotify,
  FriendRequest,
  BuddyReqType,
  GrayTipElementSubType,
  ChatType,
  Peer,
  SendMessageElement,
  KickedOffLineInfo,
  MsgType,
  GroupNotifyStatus,
  GroupNotifyType,
} from './types'
import { selfInfo } from '../common/globalVars'
import {
  FlashFileDownloadingInfo,
  FlashFileDownloadStatus,
  FlashFileSetInfo,
  FlashFileUploadingInfo,
} from '@/ntqqapi/types/flashfile'
import { logSummaryMessage } from '@/ntqqapi/log'
import { setFFMpegPath } from '@/common/utils/ffmpeg'
import { OnQRCodeLoginSucceedParameter } from '@/ntqqapi/listeners/NodeIKernelLoginListener'
import { GroupDetailInfo, LocalExitGroupReason } from '@/ntqqapi/types'
import { noop } from 'cosmokit'

declare module 'cordis' {
  interface Context {
    app: Core
  }

  interface Events {
    'nt/login-qrcode': (input: OnQRCodeLoginSucceedParameter) => void
    'nt/message-created': (input: RawMessage) => void
    'nt/offline-message-created': (input: RawMessage) => void
    'nt/message-deleted': (input: RawMessage) => void
    'nt/message-sent': (input: RawMessage) => void
    'nt/group-notify': (input: { notify: GroupNotify, doubt: boolean }) => void
    'nt/group-dismiss': (input: GroupDetailInfo) => void
    'nt/group-quit': (input: GroupDetailInfo) => void // 主动退群
    'nt/friend-request': (input: FriendRequest) => void
    'nt/system-message-created': (input: Buffer) => void
    'nt/flash-file-uploading': (input: { fileSet: FlashFileSetInfo } & FlashFileUploadingInfo) => void
    'nt/flash-file-upload-status': (input: FlashFileSetInfo) => void
    'nt/flash-file-download-status': (input: { status: FlashFileDownloadStatus, info: FlashFileSetInfo }) => void
    'nt/flash-file-downloading': (input: [fileSetId: string, info: FlashFileDownloadingInfo]) => void
    'nt/kicked-offLine': (input: KickedOffLineInfo) => void
    'pmhq/reconnect': () => void
  }
}

class Core extends Service {
  static inject = ['ntMsgApi', 'ntFriendApi', 'ntGroupApi', 'store', 'ntUserApi', 'ntFileApi', 'logger', 'pmhq']
  public startupTime = 0
  public messageReceivedCount = 0
  public messageSentCount = 0
  public lastMessageTime = 0

  constructor(protected ctx: Context, public config: Core.Config) {
    super(ctx, 'app')
  }

  async [Service.init]() {
    this.start()
    return noop
  }

  private shouldReportOfflineMessage(): boolean {
    return this.config.ob11?.connect?.some(c => c.reportOfflineMessage) ?? false
  }

  public start() {
    this.startupTime = Math.trunc(Date.now() / 1000)
    this.registerListener()
    setFFMpegPath('')
    this.ctx.on('llob/config-updated', input => {
      Object.assign(this.config, input)
      setFFMpegPath(input.ffmpeg || '')
    })
    // 冷启动时 QQ 可能已在线，Core 加载前推送的离线消息已丢失，主动拉取补偿
    if (this.shouldReportOfflineMessage()) {
      this.fetchMissedOfflineMessages(this.startupTime)
    }
  }

  public async sendMessage(
    ctx: Context,
    peer: Peer,
    sendElements: SendMessageElement[],
    deleteAfterSentFiles: string[],
  ) {
    if (peer.chatType === ChatType.Group) {
      // todo: 优化成不要每次都调用，本地缓存一个禁言标志
      const info = await ctx.ntGroupApi.getGroupAllInfo(peer.peerUid)
        .catch(() => undefined)
      const shutUpMeTimestamp = info?.shutUpMeTimestamp
      if (shutUpMeTimestamp && shutUpMeTimestamp * 1000 > Date.now()) {
        throw new Error('当前处于被禁言状态')
      }
    }
    if (!sendElements.length) {
      throw new Error('消息体无法解析，请检查是否发送了不支持的消息类型')
    }
    const returnMsg = await ctx.ntMsgApi.sendMsg(peer, sendElements)
    this.messageSentCount++
    ctx.logger.info('消息发送', peer)
    deleteAfterSentFiles.forEach(path => {
      unlink(path).catch(noop)
    })
    return returnMsg
  }

  private async handleMessage(msgList: RawMessage[]) {
    for (const message of msgList) {
      const msgTime = +message.msgTime
      if (msgTime < this.startupTime || ('isOnlineMsg' in message && !message.isOnlineMsg && message.msgType !== MsgType.GrayTips)) {
        const existing = await this.ctx.store.checkMsgExist(message)
        if (!existing) {
          this.ctx.parallel('nt/offline-message-created', message)
        }
        continue
      }
      if (message.senderUin && message.senderUin !== '0') {
        this.ctx.store.addMsgCache(message)
      }
      this.lastMessageTime = msgTime
      this.messageReceivedCount++
      logSummaryMessage(this.ctx, message).then()
      this.ctx.parallel('nt/message-created', message)
    }

    // 自动清理新消息文件
    if (!this.config.autoDeleteFile) {
      return
    }

    // 使用一个定时器处理所有文件，而不是为每个元素创建定时器
    const allPaths: string[] = []
    for (const message of msgList) {
      for (const msgElement of message.elements) {
        const picPath = msgElement.picElement?.sourcePath
        const picThumbPath = [...(msgElement.picElement?.thumbPath ?? []).values()]
        const pttPath = msgElement.pttElement?.filePath
        const filePath = msgElement.fileElement?.filePath
        const videoPath = msgElement.videoElement?.filePath
        const videoThumbPath = [...(msgElement.videoElement?.thumbPath ?? []).values()]
        const pathList = [picPath, ...picThumbPath, pttPath, filePath, videoPath, ...videoThumbPath]
        if (msgElement.picElement) {
          pathList.push(...Object.values(msgElement.picElement.thumbPath))
        }
        allPaths.push(...pathList.filter((path): path is string => path !== undefined && path !== null))
      }
    }

    if (allPaths.length > 0) {
      setTimeout(() => {
        for (const path of allPaths) {
          if (path) {
            unlink(path).then(() => this.ctx.logger.info('删除文件成功', path)).catch(noop)
          }
        }
      }, this.config.autoDeleteFileSecond! * 1000)
    }
  }

  private registerListener() {

    this.ctx.pmhq.registerReceiveHook(ReceiveCmdS.LOGIN_QR_CODE, (data) => {
      this.ctx.parallel('nt/login-qrcode', data)
    })

    this.ctx.pmhq.registerReceiveHook<{ status: number }>(ReceiveCmdS.SELF_STATUS, (info) => {
      Object.assign(selfInfo, { online: info.status !== 20 })
    })

    this.ctx.pmhq.registerReceiveHook<RawMessage[]>(ReceiveCmdS.NEW_MSG, payload => {
      this.handleMessage(payload)
    })

    const sentMsgIds = new Map<string, boolean>()
    const recallMsgIds: string[] = [] // 避免重复上报

    this.ctx.pmhq.registerReceiveHook<RawMessage[]>([ReceiveCmdS.UPDATE_MSG], payload => {
      for (const msg of payload) {
        if (
          msg.recallTime !== '0' &&
          msg.msgType === 5 &&
          msg.subMsgType === 4 &&
          msg.elements[0]?.grayTipElement?.subElementType === GrayTipElementSubType.Revoke &&
          !recallMsgIds.includes(msg.msgId)
        ) {

          recallMsgIds.push(msg.msgId)
          this.ctx.parallel('nt/message-deleted', msg)
        }
        else if (sentMsgIds.get(msg.msgId)) {
          if (msg.sendStatus === 2) {
            sentMsgIds.delete(msg.msgId)
            logSummaryMessage(this.ctx, msg).then()
            this.ctx.parallel('nt/message-sent', msg)
          }
        }
      }

      if (recallMsgIds.length > 1000) {
        recallMsgIds.shift()
      }

      // 限制Map大小，防止内存泄露
      if (sentMsgIds.size > 1000) {
        const firstKey = sentMsgIds.keys().next().value
        if (firstKey) {
          sentMsgIds.delete(firstKey)
        }
      }
    })

    this.ctx.pmhq.registerReceiveHook<[Peer, string[]]>(ReceiveCmdS.DELETE_MSG, payload => {
      // 撤回普通消息不会经过这里
      // 撤回戳一戳会经过这里
      const [peer, msgIds] = payload;
      for (const msgId of msgIds) {
        const msg = this.ctx.store.getMsgCache(msgId)
        if (!msg) {
          this.ctx.ntMsgApi.getMsgsByMsgId(peer, [msgId]).then(r => {
            for (const _msg of r.msgList) {
              this.ctx.parallel('nt/message-deleted', _msg)
            }
          }).catch(e => {
            this.ctx.logger.error('获取被撤回戳一戳消息失败', e, { peer, msgId })
          })
        }
        else {
          this.ctx.parallel('nt/message-deleted', msg)
        }
      }
    })

    this.ctx.pmhq.registerReceiveHook<RawMessage>(ReceiveCmdS.SELF_SEND_MSG, payload => {
      sentMsgIds.set(payload.msgId, true)
    })

    const groupNotifyIgnore: string[] = []
    this.ctx.pmhq.registerReceiveHook<[
      doubt: boolean,
      notifies: GroupNotify[]
    ]>('nodeIKernelGroupListener/onGroupNotifiesUpdated', async (payload) => {
      const [doubt, notifies] = payload
      for (const notify of notifies) {
        const notifyTime = Math.trunc(+notify.seq / 1000 / 1000)
        if (groupNotifyIgnore.includes(notify.seq) || notifyTime < this.startupTime) {
          continue
        }
        groupNotifyIgnore.push(notify.seq)
        if (groupNotifyIgnore.length > 1000) {
          groupNotifyIgnore.shift()
        }
        this.ctx.parallel('nt/group-notify', { notify, doubt: doubt })
      }
    })

    this.ctx.pmhq.registerReceiveHook<FriendRequestNotify>(ReceiveCmdS.FRIEND_REQUEST, payload => {
      this.ctx.ntFriendApi.clearBuddyReqUnreadCnt().catch(e => this.ctx.logger.error(`清除好友申请未读数失败`, e))
      for (const req of payload.buddyReqs) {
        if (!req.isUnread || req.isInitiator || (req.isDecide && req.reqType !== BuddyReqType.MeInitiatorWaitPeerConfirm)) {
          continue
        }
        if (+req.reqTime < this.startupTime) {
          continue
        }
        this.ctx.parallel('nt/friend-request', req)
      }
    })

    this.ctx.pmhq.registerReceiveHook<number[]>('nodeIKernelMsgListener/onRecvSysMsg', payload => {
      this.ctx.parallel('nt/system-message-created', Buffer.from(payload))
    })

    this.ctx.pmhq.registerReceiveHook<[status: number, errCode: number | string, fileSetId: string | unknown]>(ReceiveCmdS.FLASH_FILE_DOWNLOAD_STATUS, payload => {
      // 旧版本 QQ 会把 fileSetId 放在第 2 个参数
      // 新版本 QQ 会把 fileSetId 放在第 3 个参数
      const [status, errCodeOrFileSetId, fileSetIdOrFileInfo] = payload
      let fileSetId: string;
      // 没有精力一个个版本测试了，只能靠类型判断了
      if (typeof fileSetIdOrFileInfo !== 'string') {
        fileSetId = errCodeOrFileSetId as string
      }
      else {
        fileSetId = fileSetIdOrFileInfo as string
      }
      this.ctx.ntFileApi.getFlashFileInfo(fileSetId).then(info => {
        this.ctx.parallel('nt/flash-file-download-status', {
          status,
          info
        })
      }).catch(err => {
        this.ctx.logger.error(err, { fileSetId })
      })
    })

    this.ctx.pmhq.registerReceiveHook<FlashFileSetInfo>(ReceiveCmdS.FLASH_FILE_UPLOAD_STATUS, payload => {
      this.ctx.parallel('nt/flash-file-upload-status', payload)
    })

    this.ctx.pmhq.registerReceiveHook<[fileSetId: string, info: FlashFileDownloadingInfo]>(ReceiveCmdS.FLASH_FILE_DOWNLOADING, payload => {
      const [fileSetId, info] = payload
      this.ctx.parallel('nt/flash-file-downloading', [fileSetId, info])
    })

    this.ctx.pmhq.registerReceiveHook<{ fileSet: FlashFileSetInfo } & FlashFileUploadingInfo>(ReceiveCmdS.FLASH_FILE_UPLOADING, payload => {
      this.ctx.parallel('nt/flash-file-uploading', payload)
    })

    const group_dismiss_codes: string[] = []  // 不知是否是 QQ 的 bug，退群的时候会上报一个以前解散的群，这里用于避免重复上报
    this.ctx.pmhq.registerReceiveHook<GroupDetailInfo>(ReceiveCmdS.GROUP_DETAIL_INFO_UPDATE, async data => {
      if (data.localExitGroupReason === LocalExitGroupReason.DISMISS
        && !group_dismiss_codes.includes(data.groupCode)
        && data.cmdUinJoinTime > this.startupTime
      ) {
        group_dismiss_codes.push(data.groupCode)
        if (group_dismiss_codes.length > 1000) {
          group_dismiss_codes.shift()
        }
        this.ctx.parallel('nt/group-dismiss', data)
      }
      else if (data.localExitGroupReason === LocalExitGroupReason.SELF_QUIT) {
        this.ctx.parallel('nt/group-quit', data)
      }
    })

    this.ctx.pmhq.registerReceiveHook<KickedOffLineInfo>('nodeIKernelMsgListener/onKickedOffLine', info => {
      this.ctx.parallel('nt/kicked-offLine', info)
    })

    this.ctx.on('pmhq/reconnect', () => {
      const newStartupTime = Math.trunc(Date.now() / 1000)
      this.ctx.logger.info('PMHQ 重连，更新 startupTime', this.startupTime, '->', newStartupTime)
      this.startupTime = newStartupTime
      if (this.shouldReportOfflineMessage()) {
        this.fetchMissedOfflineMessages(newStartupTime)
      }
    })
  }

  private async fetchMissedOfflineMessages(referenceTime: number) {
    // 立即拍照：记录所有最近会话（不管是否未读），用于后续拉取离线消息
    let contacts: { peer: Peer, msgSeq: string }[]
    try {
      const contactResult = await this.ctx.ntUserApi.getRecentContactListSnapShot(50)
      const contactList = contactResult?.info?.changedList || []
      contacts = []
      for (const contact of contactList) {
        const peerUid = contact.peerUid || contact.id
        const chatType = contact.chatType
        if (!peerUid || !chatType) continue
        contacts.push({ peer: { chatType, peerUid, guildId: '' }, msgSeq: contact.msgSeq })
      }
    } catch (e) {
      this.ctx.logger.error('离线消息补偿: 获取联系人列表失败', e)
      return
    }

    if (!contacts.length) {
      this.ctx.logger.info('离线消息补偿: 没有最近会话')
      return
    }

    this.ctx.logger.info('离线消息补偿: 发现', contacts.length, '个会话')

    // 拉取离线群通知
    this.fetchMissedGroupNotifies(referenceTime)

    // 拉取离线好友请求
    this.fetchMissedFriendRequests(referenceTime)

    // 先激活所有会话，触发 QQ 同步消息到本地
    for (const { peer } of contacts) {
      try {
        await this.ctx.ntMsgApi.activateChat(peer)
      } catch (e) {
        this.ctx.logger.warn('离线消息补偿: 激活会话失败', peer.peerUid, e)
      }
    }

    // 每个会话拉取最新消息，筛选离线期间的消息
    // 使用 getMsgsBySeqAndCount(queryOrder=true) 从最新 seq 往旧方向取，
    // 只取一页即可——离线期间的消息一定在最新消息中，不需要向更旧方向翻页
    const pageSize = 50
    let totalFetched = 0
    const minMsgTime = referenceTime - 168 * 3600 // 忽略168小时前的消息

    // 冷启动时 QQ 可能还没同步消息，需要重试
    // 找到消息后不能立刻结束——欢迎消息等可能稍晚才同步到
    const delays = [3000, 6000, 9000]
    let lastDelay = 0
    for (const delay of delays) {
      await new Promise(resolve => setTimeout(resolve, delay - lastDelay))
      lastDelay = delay

      let roundFetched = 0
      for (const { peer, msgSeq } of contacts) {
        try {
          let msgList: RawMessage[]
          if (msgSeq) {
            const result = await this.ctx.ntMsgApi.getMsgsBySeqAndCount(peer, msgSeq, pageSize, true, false)
            msgList = result?.msgList || []
          } else {
            const result = await this.ctx.ntMsgApi.getMsgHistory(peer, '0', pageSize)
            msgList = result?.msgList || []
          }
          if (!msgList.length) continue

          for (const message of msgList) {
            const msgTime = +message.msgTime
            if (msgTime >= referenceTime) continue
            if (msgTime < minMsgTime) continue
            if (message.msgType === MsgType.GrayTips && message.chatType !== ChatType.Group) continue

            const dedupKey = `msg:${message.chatType}-${message.peerUid}-${message.msgSeq}-${message.msgRandom}-${message.msgTime}`
            const existing = await this.ctx.store.checkAndMarkDedup(dedupKey)
            if (existing) continue

            roundFetched++
            totalFetched++
            this.ctx.parallel('nt/offline-message-created', message).then()
          }
        } catch (e) {
          this.ctx.logger.warn('离线消息补偿: 拉取消息失败', peer.peerUid, e)
        }
      }

      if (roundFetched > 0) {
        this.ctx.logger.info('离线消息补偿: 本轮补发', roundFetched, '条')
      } else if (totalFetched > 0) {
        // 连续一轮无新消息，说明同步完成
        break
      } else if (delay === delays[delays.length - 1]) {
        this.ctx.logger.info('离线消息补偿: 未拉到离线消息')
      }
    }

    this.ctx.logger.info('离线消息补偿完成，共补发', totalFetched, '条')
    this.ctx.store.cleanupDedup().then()
  }

  private async fetchMissedGroupNotifies(referenceTime: number) {
    try {
      const { notifies } = await this.ctx.ntGroupApi.getGroupRequest()
      let count = 0
      for (const notify of notifies) {
        const notifyTime = Math.trunc(+notify.seq / 1000 / 1000)
        if (notifyTime >= referenceTime) continue
        if (notifyTime < referenceTime - 168 * 3600) continue
        // 只补偿未处理的请求类通知
        if (notify.status !== GroupNotifyStatus.Unhandle) continue
        if (notify.type !== GroupNotifyType.RequestJoinNeedAdminiStratorPass
          && notify.type !== GroupNotifyType.InvitedByMember
          && notify.type !== GroupNotifyType.InvitedNeedAdminiStratorPass) continue

        const dedupKey = `group-notify:${notify.seq}`
        const existing = await this.ctx.store.checkAndMarkDedup(dedupKey)
        if (existing) continue

        this.ctx.parallel('nt/group-notify', { notify, doubt: false }).then()
        count++
      }
      if (count > 0) {
        this.ctx.logger.info('离线群通知补偿完成，补发', count, '条')
      }
    } catch (e) {
      this.ctx.logger.warn('离线群通知补偿失败', e)
    }
  }

  private async fetchMissedFriendRequests(referenceTime: number) {
    try {
      const requests = await this.ctx.ntFriendApi.getFriendRequests(50)
      let count = 0
      for (const req of requests || []) {
        if (+req.reqTime >= referenceTime) continue
        if (+req.reqTime < referenceTime - 168 * 3600) continue
        if (!req.isUnread || req.isInitiator || (req.isDecide && req.reqType !== BuddyReqType.MeInitiatorWaitPeerConfirm)) continue

        const dedupKey = `friend-request:${req.friendUid}:${req.reqTime}`
        const existing = await this.ctx.store.checkAndMarkDedup(dedupKey)
        if (existing) continue

        this.ctx.parallel('nt/friend-request', req).then()
        count++
      }
      if (count > 0) {
        this.ctx.logger.info('离线好友请求补偿完成，补发', count, '条')
      }
    } catch (e) {
      this.ctx.logger.warn('离线好友请求补偿失败', e)
    }
  }
}

namespace Core {
  export interface Config extends LLOBConfig {
  }
}

export default Core
