import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { buildNativeFonts } from './build-native-fonts.mjs';
import { packager } from '@electron/packager';
await buildNativeFonts();
const outputs = await packager({
  asar: { unpack: '**/desktop/native/bin/ivo-fonts' },
  dir: '.',
  out: process.env.IVO_PACKAGE_OUT || 'release',
  name: 'Ivo',
  platform: 'darwin',
  arch: process.arch,
  appBundleId: 'com.paulcantrell.ivo',
  appCategoryType: 'public.app-category.productivity',
  overwrite: true,
  prune: true,
  ignore: [
    /^\/release(?:\/|$)/,
    /^\/desktop\/native\/bin\/(?!ivo-fonts$)/,
    /^\/tests(?:\/|$)/,
    /^\/docs(?:\/|$)/,
    /^\/research-private(?:\/|$)/,
    /^\/ios(?:\/|$)/,
    /^\/.git(?:\/|$)/,
  ],
});
for (const output of outputs)
  await access(
    path.join(output, 'Ivo.app/Contents/Resources/app.asar.unpacked/desktop/native/bin/ivo-fonts'),
    constants.X_OK,
  );
console.log(outputs.join('\n'));
