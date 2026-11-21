import { traceRasterContour } from '../../domain/geometry/raster-contour.js';
self.onmessage = ({ data: { pixels, width, height, source } }) => {
  try {
    self.postMessage({ contour: traceRasterContour(pixels, width, height, source) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
