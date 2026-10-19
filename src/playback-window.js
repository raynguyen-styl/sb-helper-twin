// Playback — scrub or play the selected month's daily timeline. Uses the tree-twin-style engine (playback.js) over
// series from the read API (sbApi.js, with an offline demo fallback). Two subjects, both a daily timeline for the
// month: a school (taps + revenue) and wearables (cohort steps + active users, where the month has them).
// Shared anatomy (central-specs capability dashboard-views).
import { openWindow, esc } from './windowing.js';
import { mk, opts, ax, line, C } from './charts.js';
import { createPlaybar } from './playback.js';
import { schools, schoolSeries, wearableCohort, isLive, setMonth } from './sbApi.js';
import { section, chart, money, fmt } from './ui.js';

// main.js sets the active month here so playback reads the matching pb_* partition.
export function setPlaybackMonth(m) { setMonth(m); }

const METRICS = {
    school: [['revenueSgd', 'Revenue (S$)'], ['txns', 'Taps']],
    wearable: [['avgSteps', 'Average steps per user'], ['medSteps', 'Median steps'], ['activeUsers', 'Active users']],
};
const labelOf = (f) => f.date.slice(5);         // MM-DD (both subjects are daily)
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso)); return m ? `${+m[3]} ${MON3[+m[2] - 1]}` : esc(iso); };

export async function openPlayback(preset) {
    const body = openWindow({ id: 'playback', title: 'Playback', sub: isLive() ? 'Day by day, from the read API' : 'A demo series (set VITE_SB_API_URL for live data)', chips: [] });
    if (!body) return;

    body.innerHTML = `
      <div class="fgrid">
        <select class="sel pb-subject" aria-label="What to play"><option value="school">A school (daily)</option><option value="wearable">Wearables (cohort)</option></select>
        <select class="sel pb-school" aria-label="School"></select>
        <select class="sel pb-metric" aria-label="Measure"></select>
      </div>
      <div class="kpis pb-kpis" aria-live="polite"></div>
      ${section({ title: 'Day by day', take: 'The whole month; the marked point is the day being played.', body: chart({ h: 220 }) })}
      <div class="pb-bar"></div>`;

    const subjectSel = body.querySelector('.pb-subject');
    const schoolSel = body.querySelector('.pb-school');
    const metricSel = body.querySelector('.pb-metric');
    const kpiEl = body.querySelector('.pb-kpis');
    const canvas = body.querySelector('canvas');
    canvas.classList.add('pb-canvas');
    const barEl = body.querySelector('.pb-bar');

    let ch = null, pb = null, frames = [], curIdx = 0;
    const fillMetrics = (subject) => { metricSel.innerHTML = METRICS[subject].map(([v, l]) => `<option value="${v}">${l}</option>`).join(''); };
    const tile = (l, v) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`;
    const kpiHtml = (subject, f) => subject === 'wearable'
        ? tile('Day', dayOf(f.date)) + tile('Average steps', fmt(f.avgSteps)) + tile('Median steps', fmt(f.medSteps)) + tile('Active users', fmt(f.activeUsers))
        : tile('Day', dayOf(f.date)) + tile('Taps', fmt(f.txns)) + tile('Revenue', money(f.revenueSgd));

    function buildChart() {
        const metric = metricSel.value;
        const data = frames.map((f) => f[metric] ?? 0);
        ch?.destroy();
        ch = mk(canvas, {
            type: 'line', numbers: { label: 'Day', fmt: (v) => (metric === 'revenueSgd' ? money(v) : fmt(v)) },
            data: { labels: frames.map(labelOf), datasets: [{
                ...line(C.blue, { fill: true, backgroundColor: C.blue + '14' }), label: metricSel.selectedOptions[0]?.textContent || 'Value',
                data, pointBackgroundColor: C.red, pointRadius: data.map(() => 0),
            }] },
            options: opts({ scales: { x: ax({ ticks: { maxTicksLimit: 8 } }), y: ax({ beginAtZero: true }) } }),
        });
    }
    function applyFrame(i, f) {
        curIdx = i;
        if (ch) {
            const ds = ch.data.datasets[0];
            ds.pointRadius = ds.data.map((_, k) => (k === i ? 5 : 0));
            ch.update('none');
        }
        kpiEl.innerHTML = kpiHtml(subjectSel.value, f);
    }
    async function load() {
        const subject = subjectSel.value;
        schoolSel.hidden = subject !== 'school';
        frames = subject === 'wearable' ? await wearableCohort() : await schoolSeries(schoolSel.value);
        buildChart();
        if (pb) pb.setFrames(frames);
        else pb = createPlaybar(barEl, { frames, labelOf, onFrame: applyFrame });
    }

    subjectSel.onchange = () => { fillMetrics(subjectSel.value); load(); };
    schoolSel.onchange = load;
    metricSel.onchange = () => { buildChart(); if (frames[curIdx]) applyFrame(curIdx, frames[curIdx]); };

    const list = await schools();
    schoolSel.innerHTML = list.map((s) => `<option value="${esc(s.schoolId)}">${esc(s.schoolId)} — ${esc(s.name || '–')}</option>`).join('');
    if (preset?.school) schoolSel.value = preset.school;
    fillMetrics('school');
    await load();
}
