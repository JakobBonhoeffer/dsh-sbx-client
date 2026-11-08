import type { SbxClientApi } from '../shared/ipc'
import type { ExplorerApi } from '../shared/explorer'
import type { LogsApi } from '../shared/logs'
import type { SandboxApi } from '../shared/sandbox'
import type { SettingsApi } from '../shared/settings'
import type { TemplatesApi } from '../shared/templates'
import type { TransferApi } from '../shared/transfer'

declare global {
  interface Window {
    /** Main window toolbar. Exposed by preload/index.ts. */
    sbxClient: SbxClientApi
    /** Sandboxes window. Exposed by preload/sandbox.ts. */
    sandboxApi: SandboxApi
    /** Settings window. Exposed by preload/settings.ts. */
    settingsApi: SettingsApi
    /** Copy files dialog. Exposed by preload/transfer.ts. */
    transferApi: TransferApi
    /** Files (file browser) dialog. Exposed by preload/explorer.ts. */
    explorerApi: ExplorerApi
    /** Logs (log viewer) dialog. Exposed by preload/logs.ts. */
    logsApi: LogsApi
    /** Templates dialog. Exposed by preload/templates.ts. */
    templatesApi: TemplatesApi
  }
}

export {}
