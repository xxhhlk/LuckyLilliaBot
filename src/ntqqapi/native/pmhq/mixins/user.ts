import { Action, Misc, Oidb } from '@/ntqqapi/proto'
import type { PMHQBase } from '../base'

export function UserMixin<T extends new (...args: any[]) => PMHQBase>(Base: T) {
  return class extends Base {
    async fetchUserInfo(uin: number) {
      const body = Oidb.FetchUserInfoReq.encode({
        uin,
        keys: [
          { key: 104 },  // 标签
          { key: 105 },  // 等级
        ],
      })
      const data = Oidb.Base.encode({
        command: 0xfe1,
        subCommand: 2,
        body,
        isReserved: 1,
      })
      const res = await this.httpSendPB('OidbSvcTrpcTcp.0xfe1_2', data)
      const oidbRespBody = Oidb.Base.decode(Buffer.from(res.pb, 'hex')).body
      const info = Oidb.FetchUserInfoResp.decode(oidbRespBody)
      const { labels } = Misc.UserInfoLabel.decode(info.body.properties.bytesProperties[0].value)
      return {
        level: info.body.properties.numberProperties[0].value,
        labels: labels.map(e => e.content),
      }
    }

    async fetchUserLoginDays(uin: number): Promise<number> {
      const body = Action.FetchUserLoginDaysReq.encode({
        field2: 0,
        json: JSON.stringify({
          msg_req_basic_info: { uint64_request_uin: [uin] },
          uint32_req_login_info: 1,
        }),
      })
      const res = await this.httpSendPB('MQUpdateSvc_com_qq_ti.web.OidbSvc.0xdef_1', body)
      const { json } = Action.FetchUserLoginDaysResp.decode(Buffer.from(res.pb, 'hex'))
      return (
        JSON.parse(json).msg_rsp_basic_info.rpt_msg_basic_info.find((e: any) => e.uint64_uin === uin)
          ?.uint32_login_days || 0
      )
    }
  }
}
