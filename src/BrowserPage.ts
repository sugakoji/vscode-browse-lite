import type { Browser, CDPSession, Page } from 'puppeteer-core'
import EventEmitterEnhancer, { EnhancedEventEmitter } from 'event-emitter-enhancer'
import { Clipboard } from './Clipboard'
import { isDarkTheme } from './Config'

enum ExposedFunc {
  EmitCopy = 'EMIT_BROWSER_LITE_ON_COPY',
  GetPaste = 'EMIT_BROWSER_LITE_GET_PASTE',
  EnableCopyPaste = 'ENABLE_BROWSER_LITE_HOOK_COPY_PASTE',
}

export class BrowserPage extends EnhancedEventEmitter {
  private client: CDPSession
  private clipboard: Clipboard
  public isActive = true

  private static ALLOWED_CLIPBOARD_EXPRESSIONS = [
    'document.dispatchEvent(new ClipboardEvent("copy"))',
    'document.execCommand("cut")',
    'document.dispatchEvent(new ClipboardEvent("paste"))',
  ]

  constructor(
    public readonly browser: Browser,
    public readonly page: Page,
  ) {
    super()
    this.clipboard = new Clipboard()
  }

  get id(): string {
    // _id is the CDP frame/target ID used for DevTools WebSocket URL.
    // It exists on CdpFrame but is not in the public type definitions.
    return (this.page.mainFrame() as any)._id
  }

  public dispose() {
    this.removeAllElseListeners()
    // @ts-expect-error
    this.removeAllListeners()
    this.client.detach()
    Promise.allSettled([
      this.page.removeExposedFunction(ExposedFunc.EnableCopyPaste),
      this.page.removeExposedFunction(ExposedFunc.EmitCopy),
      this.page.removeExposedFunction(ExposedFunc.GetPaste),
    ]).then(() => {
      this.page.close()
    })
  }

  public async send(action: string, data: object = {}, callbackId?: number) {
    // console.log('► browserPage.send', action)
    switch (action) {
      case 'Page.goForward':
        await this.page.goForward()
        break
      case 'Page.goBackward':
        await this.page.goBack()
        break
      case 'Clipboard.readText':
        try {
          this.emit({
            callbackId,
            result: await this.clipboard.readText(),
          } as any)
        }
        catch (e) {
          this.emit({
            callbackId,
            error: e.message,
          } as any)
        }
        break
      case 'Clipboard.writeText':
        try {
          const value = (data as any).value
          if (typeof value === 'string')
            await this.clipboard.writeText(value)
          this.emit({ callbackId, result: {} } as any)
        }
        catch (e) {
          this.emit({ callbackId, error: e.message } as any)
        }
        break
      default:
        if (action === 'Runtime.evaluate') {
          const expression = (data as any).expression
          if (typeof expression !== 'string' || !BrowserPage.ALLOWED_CLIPBOARD_EXPRESSIONS.includes(expression)) {
            this.emit({
              callbackId,
              error: 'Runtime.evaluate: expression not allowed',
            } as any)
            break
          }
        }
        this.client
          .send(action as any, data)
          .then((result: any) => {
            this.emit({
              callbackId,
              result,
            } as any)
          })
          .catch((err: any) => {
            this.emit({
              callbackId,
              error: err.message,
            } as any)
          })
    }
  }

  public async launch(): Promise<void> {
    await Promise.allSettled([
      // TODO setting for enable sync copy and paste
      this.page.exposeFunction(ExposedFunc.EnableCopyPaste, () => this.isActive),
      this.page.exposeFunction(ExposedFunc.EmitCopy, (text: string) => {
        if (!this.isActive)
          return
        return this.clipboard.writeText(text)
      }),
      this.page.exposeFunction(ExposedFunc.GetPaste, () => {
        if (!this.isActive)
          return ''
        return this.clipboard.readText()
      }),
    ])
    this.page.evaluateOnNewDocument(() => {
      // custom embedded devtools
      localStorage.setItem('screencastEnabled', 'false')
      localStorage.setItem('panel-selectedTab', 'console')

      // sync copy and paste
      if (window[ExposedFunc.EnableCopyPaste]?.()) {
        const copyHandler = (event: ClipboardEvent) => {
          const text = event.clipboardData?.getData('text/plain') || document.getSelection()?.toString()
          text && window[ExposedFunc.EmitCopy]?.(text)
        }
        document.addEventListener('copy', copyHandler)
        document.addEventListener('cut', copyHandler)
        document.addEventListener('paste', async (event) => {
          event.preventDefault()
          const text = await window[ExposedFunc.GetPaste]?.()
          text && document.execCommand('insertText', false, text)
        })
      }
    })

    this.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: isDarkTheme() ? 'dark' : 'light' }])

    this.client = await this.page.createCDPSession()

    // @ts-expect-error
    EventEmitterEnhancer.modifyInstance(this.client)

    // @ts-expect-error
    this.client.else((action: string, data: object) => {
      // console.log('◀ browserPage.received', action)
      this.emit({
        method: action,
        result: data,
      } as any)
    })
  }
}
