import type { MotionDocument, MotionFormat } from './MotionDocument.ts'
export interface MotionEntry { id: string, title: string, format: MotionFormat, created_at: number, bytes: number, source_bytes: number, clip_count: number, clip_names: string[], bone_count: number, duration: number, source_pack: string, source_path: string }
function result<T> (request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
export class MotionLibrary {
  private db?: Promise<IDBDatabase>
  private open (): Promise<IDBDatabase> {
    if (!this.db) this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open('rig-studio-motion-library', 1)
      request.onupgradeneeded = () => { request.result.createObjectStore('entries', { keyPath: 'id' }); request.result.createObjectStore('documents'); request.result.createObjectStore('sources') }
      request.onerror = () => { this.db = undefined; reject(request.error) }
      request.onblocked = () => { this.db = undefined; reject(new Error('Закройте другие окна студии')) }
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); this.db = undefined }; resolve(db) }
    })
    return this.db
  }
  async list (): Promise<MotionEntry[]> { const db = await this.open(); return result(db.transaction('entries').objectStore('entries').getAll()) }
  async read (id: string): Promise<MotionDocument> { const db = await this.open(), doc = await result(db.transaction('documents').objectStore('documents').get(id)); if (!doc) throw new Error('Движение не найдено'); return doc }
  async sources (): Promise<Map<string, string>> {
    const db = await this.open(), store = db.transaction('sources').objectStore('sources'), [keys, values] = await Promise.all([result(store.getAllKeys()), result(store.getAll())])
    return new Map(keys.map((key, i) => [String(key), String(values[i])]))
  }
  async save (entry: MotionEntry, doc: MotionDocument, sourceKey?: string): Promise<boolean> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['entries', 'documents', 'sources'], 'readwrite'); let saved = false
      tx.oncomplete = () => resolve(saved); tx.onabort = () => reject(tx.error ?? new Error('Не удалось сохранить движение')); tx.onerror = () => {}
      const exists = tx.objectStore('entries').getKey(entry.id)
      exists.onsuccess = () => { if (exists.result === undefined) { tx.objectStore('entries').add(entry); tx.objectStore('documents').add(doc, entry.id); saved = true }; if (sourceKey) tx.objectStore('sources').put(entry.id, sourceKey) }
    })
  }
  async remember_source (key: string, id: string): Promise<void> {
    const db = await this.open(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('sources', 'readwrite'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.objectStore('sources').put(id, key) })
  }
  async remove (id: string): Promise<void> {
    const db = await this.open(); await new Promise<void>((resolve, reject) => { const tx = db.transaction(['entries', 'documents'], 'readwrite'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.objectStore('entries').delete(id); tx.objectStore('documents').delete(id) })
  }
  async rename (id: string, title: string): Promise<void> {
    title = title.trim().slice(0,160); if (!title) throw new Error('Введите название')
    const db = await this.open(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries'), get = store.get(id); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); get.onsuccess = () => { if (get.result) store.put({ ...get.result, title }) } })
  }
}
