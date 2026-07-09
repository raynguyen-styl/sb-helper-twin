// Client-side playback engine — the tree-digital-twin pattern (frontend/tree-window.js):
// fetch a series ONCE, scrub an integer index, and Play steps a setInterval that increments the
// scrubber and wraps at the end. Ported generic + decoupled from any dataset, plus a SPEED control
// (tree-twin hard-coded 120 ms; here it's selectable). Renders a compact playbar into `bar` and
// calls onFrame(index, frame) on every step.
const SPEEDS = [['0.5×', 480], ['1×', 240], ['2×', 120], ['4×', 60]]; // ms per frame

export function createPlaybar(bar, { frames, onFrame, labelOf, startSpeedIdx = 1 }) {
  let series = frames || [];
  let timer = null;
  let speedMs = SPEEDS[startSpeedIdx][1];

  bar.innerHTML = `
    <button class="pb-play" title="Play" style="cursor:pointer">▶</button>
    <input class="pb-scrub" type="range" min="0" max="${Math.max(0, series.length - 1)}"
           value="${Math.max(0, series.length - 1)}" style="flex:1" />
    <span class="pb-date" style="min-width:118px;text-align:right;font-variant-numeric:tabular-nums"></span>
    <select class="pb-speed" title="Speed">
      ${SPEEDS.map(([l], i) => `<option value="${i}"${i === startSpeedIdx ? ' selected' : ''}>${l}</option>`).join('')}
    </select>`;

  const play = bar.querySelector('.pb-play');
  const scrub = bar.querySelector('.pb-scrub');
  const dateEl = bar.querySelector('.pb-date');
  const speedSel = bar.querySelector('.pb-speed');

  function show(i) {
    const f = series[i];
    if (!f) return;
    if (labelOf) dateEl.textContent = labelOf(f, i);
    onFrame(i, f);
  }
  function stop() { if (timer) clearInterval(timer); timer = null; play.textContent = '▶'; play.title = 'Play'; }
  function start() {
    if (timer) return stop();
    play.textContent = '⏸'; play.title = 'Pause';
    timer = setInterval(() => {
      let v = Number(scrub.value) + 1;
      if (v > Number(scrub.max)) v = Number(scrub.min) || 0; // wrap
      scrub.value = String(v);
      show(v);
    }, speedMs);
  }

  scrub.oninput = () => show(Number(scrub.value));
  play.onclick = start;
  speedSel.onchange = () => { speedMs = SPEEDS[Number(speedSel.value)][1]; if (timer) { stop(); start(); } };

  show(series.length - 1); // default frame = latest (like tree-twin)

  return {
    stop,
    showFrame: show,
    setFrames(next) {
      stop();
      series = next || [];
      scrub.min = '0';
      scrub.max = String(Math.max(0, series.length - 1));
      scrub.value = String(Math.max(0, series.length - 1));
      show(series.length - 1);
    },
  };
}
