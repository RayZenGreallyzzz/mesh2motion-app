import { createRequire } from 'node:module'
import { vi } from 'vitest'

export function wardrobeTestEnvironment() {
  const { JSDOM } = createRequire(import.meta.url)('jsdom')
  vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser)
  vi.stubGlobal('FileReader', class {
    result: ArrayBuffer | null=null
    onloadend?:()=>void
    readAsArrayBuffer(blob:Blob) {
      void blob.arrayBuffer().then(bytes=>{this.result=bytes;this.onloadend?.()})
    }
  })
}
