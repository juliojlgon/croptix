import { rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { packageExtension } from './package.mjs'

const target = process.argv[2] ?? 'chrome'
if (!['chrome', 'firefox', 'firefox-v2'].includes(target)) throw new Error(`Unknown build target: ${target}`)
if (Bun.version !== '1.4.4') throw new Error(`Use Bun 1.4.4 for reproducible builds; found ${Bun.version}`)

await rm('dist', { recursive: true, force: true })
const manifest = target === 'firefox-v2' ? 'src/utils/manifestgenv2.ts' : 'src/utils/manifestgenv3.ts'
const generated = spawnSync(process.execPath, [manifest], {
    stdio: 'inherit',
    env: { ...process.env, CROPTIX_BROWSER: target === 'chrome' ? 'chrome' : 'firefox' }
})
if (generated.status !== 0) throw new Error('Manifest generation failed')

const entries = ['content.ts', 'crunchyroll.js', 'katamari.js', 'mobile-fix.js', 'config_init.js']
if (target === 'firefox-v2') entries.push('katamari_fix_loader.ts', 'crunchyroll_loader.ts')
const result = await Bun.build({
    entrypoints: entries.map((name) => `src/utils/${name}`),
    outdir: 'dist',
    target: 'browser',
    minify: false,
    sourcemap: 'none'
})
if (!result.success) throw new AggregateError(result.logs, 'Extension bundling failed')
// Keep the shipped Emscripten worker intact. It locates its WASM and legacy assets relative to itself.
const artifact = await packageExtension('dist', 'build', target)
console.log(`Built ${artifact}`)
