import test from 'node:test';
import assert from 'node:assert/strict';
import { observeRenderedActions } from '../runtime/responsiveness/rendered-pixels.mjs';

test('a quiet compositor must show the changed pixels before an individual edit counts', async () => {
  const region = { x: 0, y: 0, width: 8, height: 1 };
  let ink = 0;
  const contents = {
    beginFrameSubscription() {},
    endFrameSubscription() {},
    async capturePage() {
      const bytes = Buffer.alloc(32, ink);
      return {
        getSize: () => region,
        crop: () => ({ toBitmap: () => bytes }),
      };
    },
  };
  const sampler = observeRenderedActions(contents, region);
  try {
    let visibleAfterDispatch;
    const sample = await sampler.measure(region, () => {
      const sent = performance.now();
      setTimeout(() => {
        visibleAfterDispatch = performance.now() - sent;
        ink = 255;
      }, 80);
    });
    assert.equal(sample.pixels, 8);
    assert.equal(sample.upperBoundOnly, undefined);
    assert.ok(sample.ms >= visibleAfterDispatch);
  } finally {
    sampler.close();
  }
});
