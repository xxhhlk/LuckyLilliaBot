// IndexedDB 消息缓存
import type { RawMessage } from '../types/webqq'

const DB_NAME = 'webqq-messages'
const DB_VERSION = 1
const STORE_NAME = 'messages'

// 每个会话最多缓存消息数
const CACHE_MAX_MESSAGES = 100

let db: IDBDatabase | null = null

// 初始化数据库
function openDb(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db)
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => reject(request.error)
    
    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }
    
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'chatKey' })
      }
    }
  })
}

// 获取缓存的消息
export async function getCachedMessages(chatType: number, peerId: string): Promise<RawMessage[] | null> {
  try {
    const database = await openDb()
    const chatKey = `${chatType}_${peerId}`
    
    return new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(chatKey)
      
      request.onsuccess = () => {
        const result = request.result
        if (result && result.messages) {
          resolve(result.messages)
        } else {
          resolve(null)
        }
      }
      
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

// 设置缓存的消息
export async function setCachedMessages(chatType: number, peerId: string, messages: RawMessage[]): Promise<void> {
  try {
    const database = await openDb()
    const chatKey = `${chatType}_${peerId}`
    const messagesToCache = messages.slice(-CACHE_MAX_MESSAGES)
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put({
        chatKey,
        messages: messagesToCache,
        timestamp: Date.now()
      })
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (e) {
    console.error('Failed to cache messages:', e)
  }
}

// 追加消息到缓存
export async function appendCachedMessage(chatType: number, peerId: string, message: RawMessage): Promise<void> {
  try {
    const existing = await getCachedMessages(chatType, peerId)
    if (existing) {
      const messages = [...existing.slice(-(CACHE_MAX_MESSAGES - 1)), message]
      await setCachedMessages(chatType, peerId, messages)
    }
  } catch (e) {
    console.error('Failed to append message:', e)
  }
}

// 从缓存中删除消息
export async function removeCachedMessage(chatType: number, peerId: string, msgId: string): Promise<void> {
  try {
    const existing = await getCachedMessages(chatType, peerId)
    if (existing) {
      const messages = existing.filter(m => m.msgId !== msgId)
      await setCachedMessages(chatType, peerId, messages)
    }
  } catch (e) {
    console.error('Failed to remove message:', e)
  }
}

// 清除所有缓存
export async function clearAllMessages(): Promise<void> {
  try {
    const database = await openDb()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (e) {
    console.error('Failed to clear messages:', e)
  }
}
