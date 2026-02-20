import type { Webview } from 'vscode'
import type { ExtensionConfiguration } from './ExtensionConfiguration'
import fs from 'fs'
import { join } from 'path'
import { Uri } from 'vscode'

export class ContentProvider {
  constructor(private config: ExtensionConfiguration) { }

  getContent(webview: Webview) {
    const root = join(this.config.extensionPath, 'dist/client')
    const indexHTML = fs.readFileSync(join(root, 'index.html'), 'utf-8')

    const cspSource = webview.cspSource
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; connect-src 'none';">`

    const html = indexHTML.replace(
      /(src|href)="(.*?)"/g,
      (_, tag, url) => `${tag}="${webview.asWebviewUri(Uri.file(join(root, url.slice(1))))}"`,
    )

    return html.replace('<head>', `<head>\n    ${csp}`)
  }
}
