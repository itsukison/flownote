const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

// Shipped native binaries that must be re-signed with the app's entitlements.
// electron-builder copies extraResources verbatim; under hardened runtime an
// unsigned (or ad-hoc signed) helper in Resources refuses to execute, so every
// binary we shell out to at runtime belongs in this list.
//   audiotee  — system audio capture (electron/audio/SystemAudioCapture.ts)
//   notchinfo — NSScreen notch probe (electron/services/notchGeometry.ts)
const NATIVE_BINARIES = ['audiotee', 'notchinfo']

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context
  const platform = packager.platform.name

  if (platform !== 'mac') return

  const resourcesPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
  const entitlementsPath = path.join(__dirname, '..', 'assets', 'entitlements.mac.plist')

  if (!fs.existsSync(entitlementsPath)) {
    console.log('[afterPack] entitlements.mac.plist not found — skipping re-sign')
    return
  }

  const identity = process.env.CSC_NAME || '-'

  for (const name of NATIVE_BINARIES) {
    const binPath = path.join(resourcesPath, name)

    if (!fs.existsSync(binPath)) {
      console.log(`[afterPack] ${name} not found at ${binPath} — skipping re-sign`)
      continue
    }

    console.log(`[afterPack] Re-signing ${name} with identity: ${identity}`)

    try {
      execSync(
        `codesign --force --options runtime --entitlements "${entitlementsPath}" --sign "${identity}" "${binPath}"`,
        { stdio: 'inherit' }
      )
      console.log(`[afterPack] ${name} re-signed successfully`)
    } catch (err) {
      console.error(`[afterPack] Failed to re-sign ${name}:`, err.message)
    }
  }
}
