import { BaseAction, Schema } from '../BaseAction'
import { OB11User } from '../../types'
import { OB11Entities } from '../../entities'
import { ActionName } from '../types'

interface Payload {
  user_id: number | string
}

interface Response extends OB11User {
  qid: string
  level: number
  login_days: number
  reg_time: number
  long_nick: string
  city: string
  country: string
  labels: string[]
}

export class GetStrangerInfo extends BaseAction<Payload, Response> {
  actionName = ActionName.GoCQHTTP_GetStrangerInfo
  payloadSchema = Schema.object({
    user_id: Schema.union([Number, String]).required()
  })

  protected async _handle(payload: Payload) {
    const uin = payload.user_id.toString()
    const data = await this.ctx.ntUserApi.getUserDetailInfoByUin(uin)
    if (data.result !== 0) {
      throw new Error(data.errMsg)
    }
    const loginDays = await this.ctx.app.pmhq.fetchUserLoginDays(+uin)
    const { labels, level } = await this.ctx.app.pmhq.fetchUserInfo(+payload.user_id)
    return {
      user_id: +data.detail.uin || 0,
      nickname: data.detail.simpleInfo.coreInfo.nick,
      sex: OB11Entities.sex(data.detail.simpleInfo.baseInfo.sex),
      age: data.detail.simpleInfo.baseInfo.age,
      qid: data.detail.simpleInfo.baseInfo.qid,
      level,
      login_days: loginDays,
      reg_time: data.detail.commonExt?.regTime ?? 0,
      long_nick: data.detail.simpleInfo.baseInfo.longNick,
      city: data.detail.commonExt?.city ?? '',
      country: data.detail.commonExt?.country ?? '',
      birthday_year: data.detail.simpleInfo.baseInfo.birthday_year,
      birthday_month: data.detail.simpleInfo.baseInfo.birthday_month,
      birthday_day: data.detail.simpleInfo.baseInfo.birthday_day,
      labels
    }
  }
}
