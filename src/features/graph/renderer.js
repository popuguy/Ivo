// Batched GPU geometry, cached text sprites, and a Canvas fallback. No document
// state or force simulation belongs here. Coordinates are CSS pixels at the edge.
const BLUE = [41 / 255, 73 / 255, 182 / 255];
const GREY = [167 / 255, 165 / 255, 158 / 255];
const NODE = [119 / 255, 123 / 255, 128 / 255];
const TAG = [150 / 255, 147 / 255, 139 / 255];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const cssColor = (rgb) => `rgb(${rgb.map((value) => Math.round(value * 255)).join(',')})`;

export function createGraphRenderer(
  root,
  canvas,
  nodes,
  edges,
  { activeId, neighbors, fontFamily, changed = () => {} } = {},
) {
  const context = canvas.getContext('2d');
  const surface = document.createElement('canvas');
  surface.setAttribute('aria-hidden', 'true');
  Object.assign(surface.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  });
  root.insertBefore(surface, canvas);
  const gl = surface.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    depth: false,
    stencil: false,
  });
  let programs = null;
  let lost = false;
  let width = 0,
    height = 0,
    ratio = 1;
  const sprites = new Map();
  const labels = new Map();
  const lineData = new Float32Array(edges.length * 2 * 6);
  const pointData = new Float32Array(nodes.length * 2 * 8);

  function program(vertex, fragment, attributes) {
    const shaders = [];
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error('Graph shader unavailable');
      }
    } catch (error) {
      for (const shader of shaders) gl.deleteShader(shader);
      throw error;
    }
    const value = gl.createProgram();
    for (const shader of shaders) gl.attachShader(value, shader);
    gl.linkProgram(value);
    for (const shader of shaders) gl.deleteShader(shader);
    if (!gl.getProgramParameter(value, gl.LINK_STATUS)) {
      gl.deleteProgram(value);
      throw new Error('Graph GPU program unavailable');
    }
    return {
      value,
      buffer: gl.createBuffer(),
      attributes: attributes.map(([name, size]) => ({
        location: gl.getAttribLocation(value, name),
        size,
      })),
      camera: gl.getUniformLocation(value, 'u_camera'),
      viewport: gl.getUniformLocation(value, 'u_viewport'),
      ratio: gl.getUniformLocation(value, 'u_ratio'),
    };
  }

  function init() {
    if (!gl) return;
    const transform = `uniform vec3 u_camera; uniform vec2 u_viewport;
      vec4 project(vec2 p) { vec2 s=p*u_camera.z+u_camera.xy;
        return vec4(s.x/u_viewport.x*2.0-1.0,1.0-s.y/u_viewport.y*2.0,0.0,1.0); }`;
    try {
      programs = {};
      programs.lines = program(
        `attribute vec2 a_position; attribute vec4 a_color; varying vec4 v_color;
          ${transform} void main(){gl_Position=project(a_position);v_color=a_color;}`,
        `precision mediump float; varying vec4 v_color; void main(){gl_FragColor=v_color;}`,
        [
          ['a_position', 2],
          ['a_color', 4],
        ],
      );
      programs.points = program(
        `attribute vec2 a_position; attribute vec4 a_color; attribute float a_radius; attribute float a_ring;
          uniform float u_ratio; varying vec4 v_color; varying float v_radius; varying float v_ring;
          ${transform} void main(){gl_Position=project(a_position);gl_PointSize=(a_radius*2.0+2.0)*u_ratio;
          v_color=a_color;v_radius=a_radius;v_ring=a_ring;}`,
        `precision mediump float; varying vec4 v_color; varying float v_radius; varying float v_ring;
          void main(){float d=length((gl_PointCoord-0.5)*(v_radius*2.0+2.0));
          float a=1.0-smoothstep(v_radius-0.6,v_radius+0.6,d);
          if(v_ring>0.5)a*=smoothstep(v_radius-1.8,v_radius-0.6,d);
          gl_FragColor=vec4(v_color.rgb,v_color.a*a);}`,
        [
          ['a_position', 2],
          ['a_color', 4],
          ['a_radius', 1],
          ['a_ring', 1],
        ],
      );
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      lost = false;
    } catch {
      disposePrograms();
      programs = null;
    }
  }

  function disposePrograms() {
    for (const item of Object.values(programs || {})) {
      gl.deleteBuffer(item.buffer);
      gl.deleteProgram(item.value);
    }
  }

  function contextLost(event) {
    event.preventDefault();
    lost = true;
    changed();
  }
  function contextRestored() {
    programs = null;
    init();
    changed();
  }
  surface.addEventListener('webglcontextlost', contextLost);
  surface.addEventListener('webglcontextrestored', contextRestored);
  init();

  function batch(item, data, count, stride, mode, camera) {
    gl.useProgram(item.value);
    gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    let offset = 0;
    for (const { location, size } of item.attributes) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
      offset += size;
    }
    gl.uniform3f(item.camera, camera.x, camera.y, camera.scale);
    gl.uniform2f(item.viewport, width, height);
    if (item.ratio) gl.uniform1f(item.ratio, ratio);
    gl.drawArrays(mode, 0, count);
    for (const { location } of item.attributes) gl.disableVertexAttribArray(location);
  }

  function sprite(node, strong, budget) {
    const key = `${node.id}:${strong}`;
    if (sprites.has(key)) return sprites.get(key);
    if (budget.left-- <= 0) return null;
    const image = document.createElement('canvas');
    const ctx = image.getContext('2d');
    const fontSize = strong ? 13 : 11.5;
    const font = `${strong ? '600' : '400'} ${fontSize}px ${fontFamily}`;
    const title = node.title.length > 36 ? `${node.title.slice(0, 34)}…` : node.title;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(title).width + 10),
      h = Math.ceil(fontSize + 12);
    image.width = Math.ceil(w * ratio);
    image.height = Math.ceil(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.font = font;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#fbfbfc';
    ctx.strokeText(title, w / 2, 4);
    ctx.fillStyle = strong ? cssColor(BLUE) : node.kind === 'tag' ? '#77736c' : '#494a4d';
    ctx.fillText(title, w / 2, 4);
    const result = { image, width: w, height: h };
    sprites.set(key, result);
    return result;
  }

  return {
    get available() {
      return Boolean(context);
    },
    get backend() {
      return programs && !lost ? 'webgl' : 'canvas';
    },
    resize(w, h, density) {
      width = w;
      height = h;
      if (ratio !== density) {
        ratio = density;
        sprites.clear();
      }
      for (const target of [canvas, surface]) {
        target.width = Math.max(1, Math.round(w * ratio));
        target.height = Math.max(1, Math.round(h * ratio));
      }
      if (gl) gl.viewport(0, 0, surface.width, surface.height);
    },
    invalidateText() {
      sprites.clear();
    },
    render(camera, { focus = null, elapsed = 1000 / 60, reducedMotion = false } = {}) {
      if (!context) return false;
      const gpu = programs && !lost;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (gpu) gl.clear(gl.COLOR_BUFFER_BIT);
      const connected = neighbors.get(focus);
      const screen = (node) => ({
        x: node.x * camera.scale + camera.x,
        y: node.y * camera.scale + camera.y,
      });
      let lineCount = 0,
        pointCount = 0;
      for (const edge of edges) {
        const a = screen(edge.from),
          b = screen(edge.to);
        if (
          Math.max(a.x, b.x) < -20 ||
          Math.min(a.x, b.x) > width + 20 ||
          Math.max(a.y, b.y) < -20 ||
          Math.min(a.y, b.y) > height + 20
        )
          continue;
        const emphasized = focus && (edge.source === focus || edge.target === focus);
        const alpha = focus ? (emphasized ? 0.72 : 0.13) : edge.kind === 'tag' ? 0.35 : 0.58;
        const color = emphasized ? BLUE : GREY;
        if (gpu) {
          for (const node of [edge.from, edge.to]) {
            lineData.set([node.x, node.y, ...color, alpha], lineCount++ * 6);
          }
        } else {
          context.globalAlpha = alpha;
          context.strokeStyle = cssColor(color);
          context.lineWidth = emphasized ? 1.25 : 0.75;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }
      const visible = [];
      function circle(node, p, radius, color, alpha, ring = false) {
        if (gpu)
          pointData.set([node.x, node.y, ...color, alpha, radius, Number(ring)], pointCount++ * 8);
        else {
          context.globalAlpha = alpha;
          context.beginPath();
          context.arc(p.x, p.y, radius, 0, Math.PI * 2);
          if (ring) {
            context.strokeStyle = cssColor(color);
            context.lineWidth = 1.2;
            context.stroke();
          } else {
            context.fillStyle = cssColor(color);
            context.fill();
          }
        }
      }
      for (const node of nodes) {
        const p = screen(node);
        if (p.x < -180 || p.x > width + 180 || p.y < -50 || p.y > height + 50) continue;
        const strong = node.id === String(activeId) || node.id === focus;
        const nearby = connected?.has(node.id);
        const alpha = focus && !strong && !nearby ? 0.25 : 1;
        const r = clamp(node.radius * Math.sqrt(camera.scale), 2.5, 13);
        if (strong) circle(node, p, r + 7, BLUE, 0.09);
        circle(
          node,
          p,
          r,
          strong ? BLUE : node.kind === 'tag' ? TAG : NODE,
          alpha,
          node.kind === 'tag',
        );
        visible.push({ node, p, r, strong, nearby });
      }
      if (gpu) {
        gl.lineWidth(1);
        batch(programs.lines, lineData.subarray(0, lineCount * 6), lineCount, 6, gl.LINES, camera);
        batch(
          programs.points,
          pointData.subarray(0, pointCount * 8),
          pointCount,
          8,
          gl.POINTS,
          camera,
        );
      }
      // No greedy label reflow on every tick: stable sprites fade with zoom and
      // focus instead of popping in/out as moving labels overlap one another.
      visible.sort((a, b) => Number(b.strong) - Number(a.strong));
      const budget = { left: 50 };
      const blend = reducedMotion ? 1 : 1 - 0.8 ** (Math.min(64, elapsed) / (1000 / 60));
      let animating = false;
      for (const { node, p, r, strong, nearby } of visible) {
        const target =
          strong || nearby
            ? 0.98
            : clamp(Math.log2(camera.scale) + 0.75, 0, 1) * (focus ? 0.24 : 0.95);
        const previous = labels.get(node.id) ?? target;
        let alpha = previous + (target - previous) * blend;
        if (Math.abs(alpha - target) < 0.005) alpha = target;
        else animating = true;
        labels.set(node.id, alpha);
        if (alpha < 0.005) continue;
        const label = sprite(node, strong, budget);
        if (!label) {
          animating = true;
          continue;
        }
        context.globalAlpha = alpha;
        context.drawImage(
          label.image,
          p.x - label.width / 2,
          p.y + r + 3,
          label.width,
          label.height,
        );
      }
      context.globalAlpha = 1;
      return animating;
    },
    destroy() {
      surface.removeEventListener('webglcontextlost', contextLost);
      surface.removeEventListener('webglcontextrestored', contextRestored);
      disposePrograms();
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      sprites.clear();
      labels.clear();
      surface.remove();
    },
  };
}
