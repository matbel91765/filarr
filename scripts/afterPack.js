/**
 * Electron Fuses - afterPack hook
 *
 * Flips security fuses in the Electron binary after packaging.
 * This hardens the production build against common attack vectors.
 */

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');

module.exports = async function afterPack(context) {
  const ext = {
    darwin: '.app',
    linux: '',
    win32: '.exe',
  };

  const electronBinaryPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}${ext[context.electronPlatformName] || ''}`
  );

  console.log(`[afterPack] Flipping fuses for: ${electronBinaryPath}`);

  await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,
    // Ensure we set every known fuse explicitly — prevents an Electron
    // upgrade from silently introducing a new fuse with an insecure default.
    strictlyRequireAllFuses: true,
    // Disable ELECTRON_RUN_AS_NODE — prevents the binary from being
    // repurposed as a generic Node.js runtime (lateral movement vector).
    [FuseV1Options.RunAsNode]: false,
    // Encrypt cookies stored on disk via OS keychain (DPAPI / Keychain /
    // libsecret). Even if an attacker reads the Cookies SQLite file,
    // they can't extract auth tokens.
    [FuseV1Options.EnableCookieEncryption]: true,
    // Disable NODE_OPTIONS env var — prevents attacker with user-level
    // access from doing `NODE_OPTIONS=--require=/tmp/evil.js filarr.exe`
    // to inject code into the app.
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    // Disable --inspect, --inspect-brk, --inspect-port — a debug port
    // on a prod binary is a full remote code exec.
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Enable ASAR integrity validation (macOS codesign + Windows
    // integrity blob). The app refuses to start if app.asar has been
    // tampered with (e.g. by malware patching JS on disk).
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    // Only load app from the ASAR archive — refuses to load from an
    // unpacked directory next to the binary (malware persistence vector).
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // Per-browser-process V8 snapshot — off keeps default behavior and
    // smaller bundle. Not a security-critical setting for us.
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    // Keep file:// extra privileges enabled for now — the app loads
    // the React bundle from file:// in prod and uses relative paths for
    // assets (pdf.js worker, fonts, i18n bundles). Flipping this to
    // false is the stricter setting but risks breaking PDF preview and
    // other features. TODO(v2.3): migrate to `app://` custom protocol
    // and set this to false.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  });

  console.log('[afterPack] Fuses flipped successfully (8 fuses applied)');
};
