// Page coordinates and source are shared by the Ivo and InDesign fixtures.
const silhouette = [
  [0, 0.24],
  [0.23, 0.14],
  [0.33, 0],
  [0.54, 0.15],
  [0.79, 0.06],
  [1, 0.22],
  [0.78, 0.45],
  [0.97, 0.63],
  [0.72, 0.69],
  [0.65, 1],
  [0.46, 0.82],
  [0.28, 0.94],
  [0.3, 0.62],
  [0.08, 0.77],
  [0.16, 0.48],
];
const passages = [
  'The sleeve hangs straight until the hand turns. Mark the break in chalk and trace it onto the paper before the second fitting.',
  'Look across the twill under a low light. At the side seam the two pieces reflect at different angles even though both came from the same length.',
  'Turn the facing inside out and flatten the fold with a finger. The smallest change at the neck becomes visible at the shoulder.',
  'Pin the back panel to the stand. Leave enough ease for a shoulder blade to move, then check the distance between the pins at rest.',
  'Cut a narrow sample across the bias. One edge curls toward the lining and the other stays flat against the worktable.',
  'Compare the two pieces under daylight. Record the direction of the nap on the reverse and keep the sample with its matching pattern.',
  'Lift the hem along the marked line and watch how the pleats separate. A few millimetres change the depth of every shadow.',
];
export const edits = Array.from(
  { length: 9 },
  (_, i) =>
    'Fitting ' +
    (i + 1) +
    '. ' +
    passages[i % passages.length] +
    ' ' +
    passages[(i + 3) % passages.length] +
    ' ',
);
export function wrapSpec() {
  const pages = Array.from({ length: 6 }, (_, p) => {
    const frames = [0, 1].map((n) => ({
      x: 20 + ((p + n) % 3) * 3,
      y: 18 + n * 166,
      w: 332 - ((p + n) % 3) * 6,
      h: 150,
    }));
    const masks = frames.flatMap((frame, n) =>
      [0, 1, 2].map((side) => {
        const mirrored = (p + n + side) % 2;
        const x = frame.x + [30, 100, 218][side] + (p % 3) * 3,
          y = frame.y + [22, 47, 51][side] + ((p + n) % 3) * 3;
        const w = [92, 106, 70][side],
          h = [69, 74, 56][side];
        const points = silhouette.map(([u, v]) => [x + w * (mirrored ? 1 - u : u), y + h * v]);
        return { x, y, w, h, points, art: (2 * p + side + n) % 6 };
      }),
    );
    if (p === 5) frames[1].h += 105;
    return { frames, masks, height: p === 5 ? 459 : 354 };
  });
  const paragraphs = Array.from(
    { length: 26 },
    (_, i) => String(i + 1).padStart(2, '0') + '  ' + passages[i % passages.length],
  );
  return {
    width: 376,
    height: 354,
    font: 'CMU Serif',
    size: 12,
    leading: 15,
    pages,
    paragraphs,
    edits,
    // The first entry is the unedited layout. Each subsequent entry is the
    // same artwork after one insertion; the end of the source is checked separately.
    referenceReflow: [
      {
        ends: [339, 603, 863, 1173, 1479, 1738, 2057, 2385, 2670, 2927, 3267],
        minimumMatches: 5,
        maximumTotalDrift: 381,
      },
      {
        ends: [391, 681, 992, 1305, 1613, 1924, 2255, 2545, 2856, 3126, 3404],
        minimumMatches: 10,
        maximumTotalDrift: 7,
      },
      {
        ends: [354, 686, 997, 1310, 1618, 1929, 2260, 2550, 2861, 3131, 3409],
        minimumMatches: 9,
        maximumTotalDrift: 25,
      },
      {
        ends: [348, 684, 995, 1308, 1616, 1927, 2258, 2548, 2859, 3129, 3407],
        minimumMatches: 9,
        maximumTotalDrift: 11,
      },
      {
        ends: [344, 676, 987, 1300, 1608, 1919, 2250, 2540, 2851, 3121, 3399],
        minimumMatches: 9,
        maximumTotalDrift: 31,
      },
      {
        ends: [378, 668, 979, 1292, 1600, 1911, 2242, 2532, 2843, 3113, 3391],
        minimumMatches: 10,
        maximumTotalDrift: 7,
      },
      {
        ends: [369, 701, 1012, 1325, 1633, 1944, 2275, 2565, 2876, 3146, 3424],
        minimumMatches: 0,
        maximumTotalDrift: 1654,
      },
      {
        ends: [383, 673, 984, 1297, 1605, 1916, 2247, 2537, 2848, 3118, 3396],
        minimumMatches: 10,
        maximumTotalDrift: 7,
      },
      {
        ends: [391, 681, 992, 1305, 1613, 1924, 2255, 2545, 2856, 3126, 3404],
        minimumMatches: 10,
        maximumTotalDrift: 7,
      },
      {
        ends: [354, 686, 997, 1310, 1618, 1929, 2260, 2550, 2861, 3131, 3409],
        minimumMatches: 9,
        maximumTotalDrift: 25,
      },
    ],
  };
}
