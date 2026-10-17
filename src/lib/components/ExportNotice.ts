export class ExportNotice {
  static show (message: string, state: 'busy' | 'success' | 'error' | 'info' = 'info'): void {
    document.getElementById('rig-export-notice')?.remove()
    const notice = document.createElement('div')
    notice.id = 'rig-export-notice'
    notice.className = `export-notice export-notice-${state}`
    notice.setAttribute('role', state === 'error' ? 'alert' : 'status')
    const text = document.createElement('span')
    text.textContent = message
    notice.append(text)
    if (state !== 'busy') {
      const close = document.createElement('button')
      close.textContent = '×'
      close.setAttribute('aria-label', 'Закрыть уведомление')
      close.onclick = () => notice.remove()
      notice.append(close)
      window.setTimeout(() => notice.remove(), state === 'error' ? 15000 : 6500)
    }
    document.body.append(notice)
  }
}
