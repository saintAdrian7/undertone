// Copies the voice-activity model, its audio worklet and the ONNX runtime WASM files from node_modules
// into the renderer's public folder, so the app never loads executable code from a CDN at runtime.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const vendor = join(root, 'src', 'renderer', 'public', 'vendor')

function copyMatching(sourceDir, targetDir, pattern) {
  if (!existsSync(sourceDir)) throw new Error(`Missing ${sourceDir}; run npm install first`)
  mkdirSync(targetDir, { recursive: true })
  let count = 0
  for (const name of readdirSync(sourceDir)) {
    if (!pattern.test(name)) continue
    copyFileSync(join(sourceDir, name), join(targetDir, name))
    count++
  }
  if (count === 0) throw new Error(`No files matching ${pattern} in ${sourceDir}`)
  return count
}

const ortFiles = /^ort-wasm.*\.(wasm|mjs)$/
const nestedOrt = join(root, 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web', 'dist')
const topOrt = join(root, 'node_modules', 'onnxruntime-web', 'dist')

const copied = {
  vad: copyMatching(join(root, 'node_modules', '@ricky0123', 'vad-web', 'dist'), join(vendor, 'vad'), /\.(onnx|js)$/),
  ort: copyMatching(topOrt, join(vendor, 'ort'), ortFiles),
  // transformers.js pins its own onnxruntime-web; use that build when npm nested it, else the top-level one.
  ortTransformers: copyMatching(existsSync(nestedOrt) ? nestedOrt : topOrt, join(vendor, 'ort-transformers'), ortFiles),
}

console.log(`copied assets: vad=${copied.vad} ort=${copied.ort} ort-transformers=${copied.ortTransformers}`)
