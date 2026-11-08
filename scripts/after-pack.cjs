// electron-builder `afterPack` hook.
// Writes install-manifest.txt (the top-level entries of the packaged app, one per line,
// "D:<name>" for directories and "F:<name>" for files) into the app directory. The NSIS
// uninstaller (build/installer.nsh) reads it and deletes exactly those entries, so an app
// installed into a folder the user chose is removed without touching anything else in it.
const fs = require('node:fs')
const path = require('node:path')

const MANIFEST_NAME = 'install-manifest.txt'

exports.default = async function afterPack(context) {
  const appDir = context.appOutDir
  const lines = fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.name !== MANIFEST_NAME)
    .map((entry) => `${entry.isDirectory() ? 'D' : 'F'}:${entry.name}`)
    .sort()

  fs.writeFileSync(path.join(appDir, MANIFEST_NAME), `${lines.join('\n')}\n`, 'utf8')
}
