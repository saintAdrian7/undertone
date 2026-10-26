// electron-builder afterPack hook: flips Electron fuses on the packaged binary so the shipped app
// cannot be run as Node, cannot be debugged through --inspect, and only loads code from its asar.
const path = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

function executablePath(context) {
  const name = context.packager.appInfo.productFilename
  switch (context.electronPlatformName) {
    case 'win32':
      return path.join(context.appOutDir, `${name}.exe`)
    case 'darwin':
      return path.join(context.appOutDir, `${name}.app`, 'Contents', 'MacOS', name)
    default:
      return path.join(context.appOutDir, name.toLowerCase().replace(/\s+/g, '-'))
  }
}

module.exports = async function afterPack(context) {
  await flipFuses(executablePath(context), {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  })
}
