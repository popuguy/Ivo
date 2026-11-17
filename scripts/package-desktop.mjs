import { packager } from '@electron/packager';
const outputs = await packager({
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
    /^\/tests(?:\/|$)/,
    /^\/docs(?:\/|$)/,
    /^\/research-private(?:\/|$)/,
    /^\/ios(?:\/|$)/,
    /^\/.git(?:\/|$)/,
  ],
});
console.log(outputs.join('\n'));
