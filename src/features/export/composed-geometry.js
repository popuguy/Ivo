const finite = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7;
/** Convert a frozen SVG-to-page matrix into bottom-left PDF points. No text measurement. */
export function composedPDFMatrix(matrix, sourceHeight, pageHeight) {
  const { a, b, c, d, e, f } = matrix;
  if (
    ![a, b, c, d, e, f, sourceHeight, pageHeight].every(finite) ||
    sourceHeight <= 0 ||
    pageHeight <= 0 ||
    Math.abs(a * d - b * c) < 1e-12
  )
    throw Error('Invalid frozen composed text transform.');
  return [a, -b, -c, d, c * sourceHeight + e, pageHeight - d * sourceHeight - f];
}

export function screenToPageMatrix(matrix, pageRect, factor = 4 / 3) {
  if (!matrix || !finite(factor) || factor <= 0 || ![pageRect.left, pageRect.top].every(finite))
    throw Error('The composed frame has no frozen page transform.');
  return {
    a: matrix.a / factor,
    b: matrix.b / factor,
    c: matrix.c / factor,
    d: matrix.d / factor,
    e: (matrix.e - pageRect.left) / factor,
    f: (matrix.f - pageRect.top) / factor,
  };
}

export function composedPDFPolygon(points, width, height, matrix, pageHeight) {
  if (
    !Array.isArray(points) ||
    points.length < 3 ||
    points.length > 256 ||
    ![width, height, pageHeight, ...Object.values(matrix)].every(finite)
  )
    throw Error('Invalid frozen text mask.');
  return points.map(({ x, y }) => {
    if (![x, y].every(finite)) throw Error('Invalid frozen mask point.');
    return {
      x: matrix.a * x * width + matrix.c * y * height + matrix.e,
      y: pageHeight - matrix.b * x * width - matrix.d * y * height - matrix.f,
    };
  });
}
