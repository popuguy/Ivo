export const preflightChecks = {
  overset: 'Overset text',
  fonts: 'Missing vault fonts',
  resources: 'Missing vault resources',
  links: 'Broken page and document links',
  descriptions: 'Missing image descriptions',
  resolution: 'Minimum effective image resolution',
};

export const preflightPresets = {
  basic: { name: 'Basic', checks: ['overset', 'fonts', 'resources'], ppi: 300 },
  digital: {
    name: 'Digital publication',
    checks: ['overset', 'fonts', 'resources', 'links', 'descriptions'],
    ppi: 150,
  },
  print: {
    name: 'Print',
    checks: ['overset', 'fonts', 'resources', 'links', 'resolution'],
    ppi: 300,
  },
};

export function preflightProfile({ name, checks, ppi }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
    throw Error('Enter a profile name of up to 80 characters.');
  if (
    !Array.isArray(checks) ||
    !checks.length ||
    checks.some((key) => !Object.hasOwn(preflightChecks, key))
  )
    throw Error('Choose at least one check.');
  if (!Number.isInteger(ppi) || ppi < 1 || ppi > 2400)
    throw Error('Enter a minimum resolution between 1 and 2400 ppi.');
  return {
    name: name.trim(),
    checks: Object.keys(preflightChecks).filter((k) => checks.includes(k)),
    ppi,
  };
}

/** Editor dimensions are points; cropping and rotation do not resample the placed picture. */
export function effectivePPI({ pixelsWide, pixelsHigh, width, height, fit }) {
  if (![pixelsWide, pixelsHigh, width, height].every((n) => Number.isFinite(n) && n > 0))
    return null;
  const ratio = (fit === 'contain' ? Math.max : Math.min)(pixelsWide / width, pixelsHigh / height);
  return ratio * 72;
}
