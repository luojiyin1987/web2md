#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, '..')
const defaultSourceDirectory = resolve(projectDirectory, '../html-extractor')
const vendorDirectory = join(projectDirectory, 'worker/vendor/html-extractor-wasm')
const manifestPath = join(vendorDirectory, 'manifest.json')

const artifactNames = [
  'html_extractor_wasm_bg.js',
  'html_extractor_wasm_bg.wasm',
  'html_extractor_wasm.d.ts',
  'html_extractor_wasm_workerd.js',
]

const allowedVendorFiles = new Set([...artifactNames, 'README.md', 'manifest.json'])

function printHelp() {
  process.stdout.write(`Usage: node scripts/sync-wasm.mjs <build|check> [options]

Commands:
  build                 Build and copy WASM artifacts into the vendor directory.
  check                 Rebuild and compare all artifacts with the vendor copies.

Options:
  --source <directory>  Set the html-extractor source directory.
                        Default: ../html-extractor
  --wasm-pack <path>    Set the wasm-pack executable path.
                        Default: wasm-pack
  -h, --help            Show this help text.
`)
}

function parseArguments(arguments_) {
  if (arguments_.includes('-h') || arguments_.includes('--help')) {
    return { help: true }
  }

  const command = arguments_[0]
  if (command !== 'build' && command !== 'check') {
    throw new Error('the command must be build or check')
  }

  let sourceDirectory = defaultSourceDirectory
  let wasmPack = 'wasm-pack'

  for (let index = 1; index < arguments_.length; index += 1) {
    const option = arguments_[index]
    const value = arguments_[index + 1]

    if (option === '--') {
      continue
    }

    if (option === '--source' || option === '--wasm-pack') {
      if (!value || value.startsWith('-')) {
        throw new Error(`${option} requires a value`)
      }

      if (option === '--source') {
        sourceDirectory = resolve(value)
      } else {
        wasmPack = value
      }
      index += 1
      continue
    }

    throw new Error(`unknown option: ${option}`)
  }

  return { command, sourceDirectory, wasmPack, help: false }
}

async function run(command, arguments_, cwd) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      stdio: 'inherit',
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      const detail = signal ? `signal ${signal}` : `exit code ${code}`
      reject(new Error(`${command} failed with ${detail}`))
    })
  })
}

async function commandOutput(command, arguments_, cwd) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []

    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString('utf8').trim())
        return
      }

      const detail = signal ? `signal ${signal}` : `exit code ${code}`
      const message = Buffer.concat(stderr).toString('utf8').trim()
      reject(new Error(`${command} failed with ${detail}${message ? `: ${message}` : ''}`))
    })
  })
}

async function sha256(path) {
  const contents = await readFile(path)
  return createHash('sha256').update(contents).digest('hex')
}

async function buildArtifacts(sourceDirectory, wasmPack) {
  const crateDirectory = join(sourceDirectory, 'crates/html-extractor-wasm')
  const prepareScript = join(sourceDirectory, 'scripts/prepare-workerd.mjs')
  const outputDirectory = await mkdtemp(join(tmpdir(), 'web2md-wasm-'))

  try {
    await run(
      wasmPack,
      ['build', crateDirectory, '--release', '--target', 'bundler', '--out-dir', outputDirectory],
      sourceDirectory,
    )
    await run(
      process.execPath,
      [
        prepareScript,
        join(outputDirectory, 'html_extractor_wasm.js'),
        join(outputDirectory, 'html_extractor_wasm_workerd.js'),
      ],
      sourceDirectory,
    )

    for (const name of artifactNames) {
      await readFile(join(outputDirectory, name))
    }

    return outputDirectory
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true })
    throw error
  }
}

async function sourceMetadata(sourceDirectory) {
  const trackedChanges = await commandOutput(
    'git',
    ['status', '--short', '--untracked-files=no'],
    sourceDirectory,
  )
  if (trackedChanges) {
    throw new Error('the html-extractor source has uncommitted tracked changes')
  }

  const commit = await commandOutput('git', ['rev-parse', 'HEAD'], sourceDirectory)
  let repository

  try {
    repository = await commandOutput('git', ['remote', 'get-url', 'origin'], sourceDirectory)
  } catch {
    repository = null
  }

  return { repository, commit }
}

async function artifactHashes(directory) {
  const hashes = {}
  for (const name of artifactNames) {
    hashes[name] = await sha256(join(directory, name))
  }
  return hashes
}

async function writeManifest(source, wasmPackVersion, hashes) {
  const manifest = {
    schemaVersion: 1,
    source,
    toolchain: {
      wasmPack: wasmPackVersion,
    },
    wasmSha256: hashes['html_extractor_wasm_bg.wasm'],
    files: hashes,
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function build(options) {
  const source = await sourceMetadata(options.sourceDirectory)
  const wasmPackVersion = await commandOutput(
    options.wasmPack,
    ['--version'],
    options.sourceDirectory,
  )
  const outputDirectory = await buildArtifacts(options.sourceDirectory, options.wasmPack)

  try {
    const hashes = await artifactHashes(outputDirectory)
    await mkdir(vendorDirectory, { recursive: true })

    for (const name of artifactNames) {
      await copyFile(join(outputDirectory, name), join(vendorDirectory, name))
    }

    for (const staleName of ['workerd.js', 'workerd.d.ts', 'html_extractor_wasm_bg.d.ts']) {
      await rm(join(vendorDirectory, staleName), { force: true })
    }

    await writeManifest(source, wasmPackVersion, hashes)
    process.stdout.write(`updated WASM vendor files from ${source.commit}\n`)
  } finally {
    await rm(outputDirectory, { recursive: true, force: true })
  }
}

async function check(options) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const source = await sourceMetadata(options.sourceDirectory)
  const wasmPackVersion = await commandOutput(
    options.wasmPack,
    ['--version'],
    options.sourceDirectory,
  )

  if (manifest.schemaVersion !== 1 || manifest.source?.commit !== source.commit) {
    throw new Error(`vendor source commit does not match ${source.commit}`)
  }
  if (manifest.toolchain?.wasmPack !== wasmPackVersion) {
    throw new Error(`vendor wasm-pack version does not match ${wasmPackVersion}`)
  }

  const vendorFiles = await readdir(vendorDirectory)
  const unexpectedFiles = vendorFiles.filter((name) => !allowedVendorFiles.has(name))
  if (unexpectedFiles.length > 0) {
    throw new Error(`unexpected vendor files: ${unexpectedFiles.join(', ')}`)
  }

  const outputDirectory = await buildArtifacts(options.sourceDirectory, options.wasmPack)

  try {
    const generatedHashes = await artifactHashes(outputDirectory)
    const vendorHashes = await artifactHashes(vendorDirectory)

    for (const name of artifactNames) {
      const expected = manifest.files?.[name]
      if (expected !== generatedHashes[name] || expected !== vendorHashes[name]) {
        throw new Error(`${name} does not match the recorded source build`)
      }
    }

    if (manifest.wasmSha256 !== vendorHashes['html_extractor_wasm_bg.wasm']) {
      throw new Error('the recorded WASM SHA-256 does not match the vendor file')
    }

    process.stdout.write(`WASM vendor files match ${source.commit}\n`)
  } finally {
    await rm(outputDirectory, { recursive: true, force: true })
  }
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    printHelp()
  } else if (options.command === 'build') {
    await build(options)
  } else {
    await check(options)
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
