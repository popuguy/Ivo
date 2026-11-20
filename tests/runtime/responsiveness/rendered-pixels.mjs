// Read only the test control or text region and discard the frame immediately.
// Scale from CSS coordinates to the capture surface, including Retina displays.
function crop(image, region, viewport) {
  const size = image.getSize();
  const xScale = size.width / viewport.width,
    yScale = size.height / viewport.height;
  const rect = {
    x: Math.floor(region.x * xScale),
    y: Math.floor(region.y * yScale),
    width: Math.max(1, Math.round(region.width * xScale)),
    height: Math.max(1, Math.round(region.height * yScale)),
  };
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > size.width ||
    rect.y + rect.height > size.height
  )
    throw Error('Measured ink is outside the window');
  const data = image.crop(rect).toBitmap();
  return Uint8Array.from({ length: data.length / 4 }, (_, i) => data[i * 4]);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Record the arrival of a compositor frame before doing any pixel processing.
// Count an action when at least 80% of its high-contrast changed pixels match
// the settled frame. Capture on independent frames, outside the input handler.
export function observeRenderedActions(contents, viewport) {
  let active;
  contents.beginFrameSubscription(false, (image) => {
    if (!active) return;
    const now = performance.now(),
      bytes = crop(image, active.region, viewport);
    active.frames.push({ elapsed: now - active.start, bytes });
  });
  async function measure(region, dispatch, label = 'Input') {
    const sample = { region, frames: [] };
    try {
      const baseline = crop(await contents.capturePage(), region, viewport);
      sample.start = performance.now();
      active = sample;
      await dispatch();
      await pause(260);
      // Idle or occluded windows can stop delivering callbacks between changes.
      // Independently read the settled surface rather than trusting the last callback.
      const image = await contents.capturePage();
      const elapsed = performance.now() - sample.start;
      const final = crop(image, region, viewport);
      if (final.length !== baseline.length) throw Error('Window scale changed during sampling');
      const changed = [];
      for (let i = 0; i < final.length; i++)
        if (Math.abs(final[i] - baseline[i]) > 64) changed.push(i);
      if (changed.length < 3) throw Error(label + ' produced no distinct glyph or icon');
      const first = sample.frames.find(
        (frame) =>
          changed.filter((i) => Math.abs(frame.bytes[i] - final[i]) < 25).length >=
          0.8 * changed.length,
      );
      return {
        ms: first?.elapsed ?? elapsed,
        pixels: changed.length,
        ...(first ? {} : { upperBoundOnly: true }),
      };
    } finally {
      active = null;
    }
  }
  // The crop sits downstream of the insertion point, beyond the entire typed
  // word. A blinking or moving caret cannot count as progress here.
  async function measureBurst(region, text, dispatch, interval) {
    const sample = { region, frames: [] };
    let timer, reading;
    try {
      const baseline = crop(await contents.capturePage(), region, viewport);
      const keys = [];
      sample.start = performance.now();
      active = sample;
      // Chromium can stop sending compositor callbacks when successive frames
      // are identical. If the stream goes quiet, independently sample the
      // window surface. Timestamp its arrival, never an earlier requested time.
      timer = setInterval(() => {
        const last = sample.frames.at(-1)?.elapsed ?? 0;
        if (reading || performance.now() - sample.start - last < 35) return;
        const count = sample.frames.length;
        reading = contents
          .capturePage()
          .then((image) => {
            const elapsed = performance.now() - sample.start;
            if (active === sample && sample.frames.length === count)
              sample.frames.push({ elapsed, bytes: crop(image, region, viewport) });
          })
          .catch((error) => {
            sample.error = error;
          })
          .finally(() => {
            reading = null;
          });
      }, 17);
      for (const letter of text) {
        if (keys.length) await pause(interval);
        keys.push(performance.now() - sample.start);
        dispatch(letter);
      }
      await pause(400);
      clearInterval(timer);
      await reading;
      if (sample.error) throw sample.error;
      const final = crop(await contents.capturePage(), region, viewport);
      function changes(a, b) {
        let different = 0;
        for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 64) different++;
        return different;
      }
      const changed = changes(baseline, final);
      if (changed < 12) throw Error('Burst did not visibly change the measured text');
      let previous = baseline;
      const transitions = [];
      for (const frame of sample.frames) {
        if (changes(previous, frame.bytes) < 12) continue;
        transitions.push(frame);
        previous = frame.bytes;
      }
      const settled = transitions.findLastIndex((frame) => changes(frame.bytes, final) > 2) + 1;
      if (!transitions[settled])
        throw Error('Final burst ink was never observed on a rendered frame');
      const paints = transitions.slice(0, settled + 1).map((frame) => frame.elapsed);
      return {
        keys,
        paints,
        first: paints[0] - keys[0],
        finish: Math.max(0, paints.at(-1) - keys.at(-1)),
        longestPause: Math.max(...paints.map((time, i) => time - (paints[i - 1] ?? keys[0]))),
        whileTyping: paints.filter((time) => time < keys.at(-1)).length,
      };
    } finally {
      clearInterval(timer);
      active = null;
    }
  }
  async function containsInk(region) {
    const pixels = crop(await contents.capturePage(), region, viewport);
    return pixels.reduce((n, pixel) => n + (pixel < 120 ? 1 : 0), 0) >= 4;
  }
  return { measure, measureBurst, containsInk, close: () => contents.endFrameSubscription() };
}
