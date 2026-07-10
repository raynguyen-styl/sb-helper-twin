// Playback window — scrub / play the February timeline. Uses the tree-twin-style engine
// (playback.js) over series from sb-api (sbApi.js → shared ClickHouse, with offline demo fallback).
// Both subjects are a daily Feb-2026 timeline: School (txns + revenue — watch the CNY drop and the
// weekday rhythm) and Wearables (cohort steps + active users).
import { openWindow } from './windowing.js';
import { mk, opts, ax, line, C } from './charts.js';
import { createPlaybar } from './playback.js';
import { schools, schoolSeries, wearableCohort, isLive, setMonth } from './sbApi.js';

// main.js sets the active month here so playback reads the matching pb_* partition.
export function setPlaybackMonth(m) { setMonth(m); }

const METRICS = {
  school: [['revenueSgd', 'Revenue (S$)'], ['txns', 'Transactions']],
  wearable: [['avgSteps', 'Avg steps/user'], ['medSteps', 'Median steps'], ['activeUsers', 'Active users']],
};
const labelFor = () => (f) => f.date.slice(5);         // MM-DD (both subjects are daily)

export async function openPlayback(preset) {
  const body = openWindow({
    id: 'playback', title: 'Playback',
    sub: isLive() ? 'Feb 2026 · daily (ClickHouse)' : 'Feb 2026 · daily demo (set VITE_SB_API_URL for live)',
    chips: [],
  });
  if (!body) return;

  body.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <select class="pb-subject">
        <option value="school">School (daily)</option>
        <option value="wearable">Wearables (cohort)</option>
      </select>
      <select class="pb-school" style="max-width:230px"></select>
      <select class="pb-metric"></select>
    </div>
    <div class="pb-kpis" style="display:flex;gap:18px;margin-bottom:6px;font-size:12px;color:#52514e;min-height:34px"></div>
    <div style="position:relative;height:210px"><canvas class="pb-canvas"></canvas></div>
    <div class="pb-bar" style="display:flex;gap:10px;align-items:center;margin-top:10px"></div>`;

  const subjectSel = body.querySelector('.pb-subject');
  const schoolSel = body.querySelector('.pb-school');
  const metricSel = body.querySelector('.pb-metric');
  const kpis = body.querySelector('.pb-kpis');
  const canvas = body.querySelector('.pb-canvas');
  const bar = body.querySelector('.pb-bar');

  let chart = null, pb = null, frames = [], curIdx = 0;

  const fillMetrics = (subject) => {
    metricSel.innerHTML = METRICS[subject].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  };
  const fmtVal = (metric, v) => {
    if (v == null) return '—';
    if (metric === 'revenueSgd') return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return Number(v).toLocaleString();
  };
  function kpiHtml(subject, f) {
    const chip = (l, v) => `<div><div style="color:#8e8e93;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">${l}</div><div style="font-size:16px;font-weight:600;color:#1d1d1f">${v}</div></div>`;
    if (subject === 'wearable') {
      return chip('Day', f.date) + chip('Avg steps', fmtVal('', f.avgSteps))
        + chip('Median steps', fmtVal('', f.medSteps)) + chip('Active users', fmtVal('', f.activeUsers));
    }
    return chip('Day', f.date) + chip('Transactions', fmtVal('', f.txns))
      + chip('Revenue', fmtVal('revenueSgd', f.revenueSgd));
  }

  function buildChart() {
    const metric = metricSel.value;
    const labelOf = labelFor(subjectSel.value);
    const labels = frames.map((f, i) => labelOf(f, i));
    const data = frames.map((f) => f[metric] ?? 0);
    if (chart) chart.destroy();
    chart = mk(canvas, {
      type: 'line',
      data: { labels, datasets: [{
        ...line(C.blue, { fill: true, backgroundColor: 'rgba(42,120,214,0.08)' }),
        data, pointBackgroundColor: C.red, pointRadius: data.map(() => 0),
      }] },
      options: opts({ scales: { x: ax({ ticks: { maxTicksLimit: 8 } }), y: ax({ beginAtZero: true }) } }),
    });
  }
  function applyFrame(i, f) {
    curIdx = i;
    if (chart) {
      const ds = chart.data.datasets[0];
      ds.pointRadius = ds.data.map((_, k) => (k === i ? 5 : 0));
      chart.update('none');
    }
    kpis.innerHTML = kpiHtml(subjectSel.value, f);
  }

  async function load() {
    const subject = subjectSel.value;
    schoolSel.style.display = subject === 'school' ? '' : 'none';
    frames = subject === 'wearable' ? await wearableCohort() : await schoolSeries(schoolSel.value);
    buildChart();
    if (pb) pb.setFrames(frames);
    else pb = createPlaybar(bar, { frames, labelOf: labelFor(subject), onFrame: applyFrame });
  }

  subjectSel.onchange = () => { fillMetrics(subjectSel.value); load(); };
  schoolSel.onchange = load;
  metricSel.onchange = () => { buildChart(); applyFrame(curIdx, frames[curIdx]); };

  const list = await schools();
  schoolSel.innerHTML = list.map((s) => `<option value="${s.schoolId}">${s.schoolId} — ${s.name || '—'}</option>`).join('');
  if (preset?.school) schoolSel.value = preset.school;
  fillMetrics('school');
  await load();
}
