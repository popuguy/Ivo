import { createGrepWorker } from './grep-worker-factory.js';

export function runGrep(request, signal) {
  signal.throwIfAborted();
  const worker = createGrepWorker();
  return new Promise((resolve, reject) => {
    function finish(callback, value) {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      callback(value);
    }
    const cancel = () => finish(reject, signal.reason);
    const timer = setTimeout(
      () => finish(reject, new Error('Search timed out. Try a narrower expression.')),
      2000,
    );
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.error) finish(reject, new Error(data.error));
      else finish(resolve, data.rows);
    };
    worker.onerror = () => finish(reject, new Error('The GREP search could not run.'));
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(reject, error);
    }
  });
}

// Captured ranges retain their own styling and links when used more than once or out of order.
export function replacementParts(template, groups) {
  const parts = [];
  let literal = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i],
      next = template[i + 1];
    if (c === '$' && /[0-9]/.test(next || ' ')) {
      const number = template.slice(i + 1).match(/^\d{1,2}/)[0];
      const index = Number(number);
      if (index >= groups.length) throw new Error('There is no capture group $' + number + '.');
      if (literal) parts.push(literal);
      literal = '';
      if (groups[index]) parts.push(groups[index]);
      i += number.length;
    } else if (c === '$' && next === '$') {
      literal += '$';
      i++;
    } else if (c === '\\' && next && Object.hasOwn({ r: 1, n: 1, t: 1, '\\': 1, $: 1 }, next)) {
      literal += { r: '\r', n: '\n', t: '\t', '\\': '\\', $: '$' }[next];
      i++;
    } else literal += c;
  }
  if (literal) parts.push(literal);
  return parts;
}
