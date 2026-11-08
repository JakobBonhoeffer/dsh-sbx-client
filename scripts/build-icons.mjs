// Renders build/icon.svg to build/icon.png (1024x1024).
// electron-builder converts that PNG into the multi-size .ico for Windows by itself.
// Run with: pnpm icons
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'build', 'icon.svg')
const target = join(root, 'build', 'icon.png')

mkdirSync(dirname(target), { recursive: true })
await sharp(source, { density: 384 }).resize(1024, 1024).png().toFile(target)
console.log(`Wrote ${target}`)
