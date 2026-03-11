const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context
  const platform = packager.platform.name

  if (platform !== 'mac') return

  const resourcesPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
  const audioTeePath = path.join(resourcesPath, 'audiotee')
  const entitlementsPath = path.join(__dirname, '..', 'assets', 'entitlements.mac.plist')

  if (!fs.existsSync(audioTeePath)) {
    console.log('[afterPack] audiotee binary not found at', audioTeePath, '— skipping re-sign')
    return
  }

  if (!fs.existsSync(entitlementsPath)) {
    console.log('[afterPack] entitlements.mac.plist not found — skipping re-sign')
    return
  }

  const identity = process.env.CSC_NAME || '-'
  console.log(`[afterPack] Re-signing audiotee with identity: ${identity}`)

  try {
    execSync(
      `codesign --force --options runtime --entitlements "${entitlementsPath}" --sign "${identity}" "${audioTeePath}"`,
      { stdio: 'inherit' }
    )
    console.log('[afterPack] audiotee re-signed successfully')
  } catch (err) {
    console.error('[afterPack] Failed to re-sign audiotee:', err.message)
  }
}
