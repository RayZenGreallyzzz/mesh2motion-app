export interface LibraryEntry {
  id: string
  title: string
  created_at: number
  bytes: number
  clip_count: number
  bone_count: number
  skeleton_count: number
}

function request_value<T> (request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export class RigLibrary {
  private database?: Promise<IDBDatabase>

  private open (): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open('rig-studio-own-rigs', 1)
        request.onupgradeneeded = () => {
          request.result.createObjectStore('entries', { keyPath: 'id' })
          request.result.createObjectStore('files')
          request.result.createObjectStore('mappings')
        }
        request.onerror = () => { this.database = undefined; reject(request.error) }
        request.onblocked = () => { this.database = undefined; reject(new Error('Закройте другие окна приложения и повторите')) }
        request.onsuccess = () => {
          request.result.onversionchange = () => { request.result.close(); this.database = undefined }
          resolve(request.result)
        }
      })
    }
    return this.database
  }

  async list (): Promise<LibraryEntry[]> {
    const db = await this.open()
    const entries = await request_value(db.transaction('entries').objectStore('entries').getAll()) as LibraryEntry[]
    return entries.sort((a, b) => b.created_at - a.created_at)
  }

  async read (id: string): Promise<ArrayBuffer> {
    const db = await this.open()
    const value = await request_value(db.transaction('files').objectStore('files').get(id)) as ArrayBuffer | undefined
    if (!value) throw new Error('Файл в библиотеке не найден')
    return value
  }

  async save (entry: LibraryEntry, bytes: ArrayBuffer): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['entries', 'files'], 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('Не удалось сохранить файл'))
      transaction.onerror = () => {} // onabort also covers commit/quota failures
      transaction.objectStore('entries').add(entry)
      transaction.objectStore('files').add(bytes, entry.id)
    })
  }

  async remove (id: string): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['entries', 'files'], 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      transaction.objectStore('entries').delete(id)
      transaction.objectStore('files').delete(id)
    })
  }

  async get_mapping (key: string): Promise<Record<string, string> | undefined> {
    const db = await this.open()
    return request_value(db.transaction('mappings').objectStore('mappings').get(key))
  }

  async save_mapping (key: string, mapping: Record<string, string>): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('mappings', 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      transaction.objectStore('mappings').put(mapping, key)
    })
  }
}
