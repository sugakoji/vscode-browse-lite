import type { Browser } from 'puppeteer-core'
import type { ExtensionContext } from 'vscode'
import type { ExtensionConfiguration } from './ExtensionConfiguration'
import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { platform } from 'os'
import { join } from 'path'
import edge from '@chiragrupani/karma-chromium-edge-launcher'
import chrome from 'karma-chrome-launcher'
import puppeteer from 'puppeteer-core'
import { window, workspace } from 'vscode'
import { BrowserPage } from './BrowserPage'
import { tryPort } from './Config'

export class BrowserClient extends EventEmitter {
  private browser: Browser

  constructor(private config: ExtensionConfiguration, private ctx: ExtensionContext) {
    super()
  }

  private async launchBrowser() {
    const chromeArgs = []

    this.config.debugPort = await tryPort(this.config.debugPort)

    chromeArgs.push(`--remote-debugging-port=${this.config.debugPort}`)

    chromeArgs.push(`--remote-allow-origins=http://localhost:${this.config.debugPort},http://127.0.0.1:${this.config.debugPort}`)

    if (this.config.proxy && this.config.proxy.length > 0) {
      if (/^https?:\/\/[^/\s]+:\d+$/.test(this.config.proxy))
        chromeArgs.push(`--proxy-server=${this.config.proxy}`)
    }

    if (this.config.otherArgs && this.config.otherArgs.length > 0) {
      const denylist = [
        '--disable-web-security',
        '--allow-file-access-from-files',
        '--allow-file-access',
        '--disable-site-isolation-trials',
        '--allow-running-insecure-content',
      ]
      const filtered = this.config.otherArgs
        .split(/\s+/)
        .filter(arg => !denylist.some(denied => arg.startsWith(denied)))
        .join(' ')
      if (filtered.length > 0)
        chromeArgs.push(filtered)
    }

    const chromePath = this.config.chromeExecutable || this.getChromiumPath()

    if (!chromePath) {
      window.showErrorMessage(
        'No Chrome installation found, or no Chrome executable set in the settings',
      )
      return
    }

    if (platform() === 'linux')
      chromeArgs.push('--no-sandbox')

    const ignoreHTTPSErrors = workspace.isTrusted
      ? workspace.getConfiguration('browse-lite').get<boolean>('ignoreHttpsErrors')
      : false

    let userDataDir
    if (this.config.storeUserData)
      userDataDir = join(this.ctx.globalStorageUri.fsPath, 'UserData')

    this.browser = await puppeteer.launch({
      executablePath: chromePath,
      args: chromeArgs,
      acceptInsecureCerts: ignoreHTTPSErrors,
      ignoreDefaultArgs: ['--mute-audio'],
      userDataDir,
    })

    // close the initial empty page
    ; (await this.browser.pages()).map(i => i.close())
  }

  public async newPage(): Promise<BrowserPage> {
    if (!this.browser)
      await this.launchBrowser()

    const page = new BrowserPage(this.browser, await this.browser.newPage())
    await page.launch()
    return page
  }

  public dispose(): Promise<void> {
    return new Promise((resolve) => {
      if (this.browser) {
        this.browser.close()
        this.browser = null
      }
      resolve()
    })
  }

  public getChromiumPath(): string | undefined {
    const knownChromiums = [...Object.entries(chrome), ...Object.entries(edge)]

    for (const [key, info] of knownChromiums) {
      if (!key.startsWith('launcher'))
        continue

      const path = info?.[1]?.prototype?.DEFAULT_CMD?.[process.platform]
      if (path && typeof path === 'string' && existsSync(path))
        return path
    }

    return undefined
  }
}
