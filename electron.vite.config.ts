import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

// Main and preload are emitted as CommonJS (the package has no "type": "module")
// because sandboxed preload scripts cannot be ES modules.
//
// Every window has its own page and its own preload, so each page only gets the API it needs:
//   index    main window toolbar      (preload/index.ts)
//   sandbox  Sandboxes window         (preload/sandbox.ts)
//   settings Settings window          (preload/settings.ts)
export default defineConfig({
  main: {},
  preload: {
    build: {
      // Sandboxed preload scripts cannot require() other local files, so every entry must be a
      // single self-contained file. Without this, code shared by two preloads is split into
      // chunks/*.js and the preload fails to load.
      isolatedEntries: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          sandbox: resolve(__dirname, 'src/preload/sandbox.ts'),
          settings: resolve(__dirname, 'src/preload/settings.ts'),
          transfer: resolve(__dirname, 'src/preload/transfer.ts'),
          explorer: resolve(__dirname, 'src/preload/explorer.ts'),
          logs: resolve(__dirname, 'src/preload/logs.ts'),
          templates: resolve(__dirname, 'src/preload/templates.ts')
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          sandbox: resolve(__dirname, 'src/renderer/sandbox.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          transfer: resolve(__dirname, 'src/renderer/transfer.html'),
          explorer: resolve(__dirname, 'src/renderer/explorer.html'),
          logs: resolve(__dirname, 'src/renderer/logs.html'),
          templates: resolve(__dirname, 'src/renderer/templates.html')
        }
      }
    }
  }
})
