/**
 * Local copy of types from src/onebot11/ to avoid importing main project source
 * which causes ts-jest compilation issues with @/ path aliases
 */

export { ActionName } from './action-types'

// From src/onebot11/types.ts
export enum OB11MessageDataType {
  Text = 'text',
  Image = 'image',
  Music = 'music',
  Video = 'video',
  Record = 'record',
  File = 'file',
  FlashFile = 'flash_file',
  At = 'at',
  Reply = 'reply',
  Json = 'json',
  Face = 'face',
  Mface = 'mface',
  Markdown = 'markdown',
  Node = 'node',
  Forward = 'forward',
  Xml = 'xml',
  Poke = 'poke',
  Dice = 'dice',
  Rps = 'rps',
  Contact = 'contact',
  Shake = 'shake',
  Keyboard = 'keyboard',
}

export interface OB11MessageText {
  type: OB11MessageDataType.Text
  data: { text: string }
}

export interface OB11MessageImage {
  type: OB11MessageDataType.Image
  data: { file: string; summary?: string; subType?: number }
}

export interface OB11MessageRecord {
  type: OB11MessageDataType.Record
  data: { file: string }
}

export interface OB11MessageAt {
  type: OB11MessageDataType.At
  data: { qq: string | 'all' }
}

export interface OB11MessageReply {
  type: OB11MessageDataType.Reply
  data: { id: string }
}

export interface OB11MessageFace {
  type: OB11MessageDataType.Face
  data: { id: string }
}

export interface OB11MessageNode {
  type: OB11MessageDataType.Node
  data: { id?: string; content?: OB11MessageData[] }
}

export type OB11MessageData =
  | OB11MessageText
  | OB11MessageImage
  | OB11MessageRecord
  | OB11MessageAt
  | OB11MessageReply
  | OB11MessageFace
  | OB11MessageNode
  | { type: string; data: Record<string, any> }
