import { access, constants } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { buildNativeFonts } from './build-native-fonts.mjs';
import { buildNativeText } from './build-native-text.mjs';
import { packager } from '@electron/packager';
import { qualifyDesktopInput } from './qualify-desktop-input.mjs';
await Promise.all([buildNativeFonts(), buildNativeText()]);
await qualifyDesktopInput();
const outputs = await packager({
  asar: { unpack: '**/desktop/native/bin/ivo-*' },
  electronZipDir: process.env.IVO_ELECTRON_ZIP_DIR || undefined,
  dir: '.',
  out: process.env.IVO_PACKAGE_OUT || 'release',
  name: 'Ivo',
  platform: 'darwin',
  arch: process.arch,
  appBundleId: 'com.paulcantrell.ivo',
  appCategoryType: 'public.app-category.productivity',
  osxSign: {
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: () => ({ timestamp: 'none', hardenedRuntime: false }),
  },
  overwrite: true,
  prune: true,
  ignore: [
    /^\/release(?:\/|$)/,
    /^\/desktop\/native\/bin\/(?!ivo-(?:fonts|text)$)/,
    /^\/tests(?:\/|$)/,
    /^\/docs(?:\/|$)/,
    /^\/research-private(?:\/|$)/,
    /^\/ios(?:\/|$)/,
    /^\/.git(?:\/|$)/,
  ],
});
for (const output of outputs) {
  execFileSync('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    path.join(output, 'Ivo.app'),
  ]);
  for (const binary of ['ivo-fonts', 'ivo-text'])
    await access(
      path.join(output, 'Ivo.app/Contents/Resources/app.asar.unpacked/desktop/native/bin', binary),
      constants.X_OK,
    );
}
console.log(outputs.join('\n'));
