// Map a natural-language date phrase onto exact February-2026 dates (SGT).
// The dataset is a fixed historical month, so "today"/"now" are meaningless —
// everything anchors inside 2026-02-01 .. 2026-02-28. Returns date strings plus
// a ready-to-paste SQL predicate on txn_date (ClickHouse dialect; also valid for toDateOrNull(hr_date)).

const Y = 2026, M = 2, LAST = 28;
const pad = (n) => String(n).padStart(2, "0");
const d = (day) => `2026-02-${pad(day)}`;
// 2026-02-01 is a Sunday. isodow: Mon=1..Sun=7.
const isodow = (day) => (((new Date(Date.UTC(Y, M - 1, day)).getUTCDay()) + 6) % 7) + 1;

function betweenPredicate(from, to, col = "txn_date") {
  return `${col} BETWEEN toDate('${from}') AND toDate('${to}')`;
}

export function resolveTimeRange(textRaw) {
  const text = String(textRaw || "").toLowerCase().trim();
  const whole = { from: d(1), to: d(LAST), label: "all of February 2026", predicate: betweenPredicate(d(1), d(LAST)) };
  if (!text) return whole;

  // explicit YYYY-MM-DD or MM-DD / M-D (clamped into Feb)
  const iso = text.match(/\b20\d{2}[-/](\d{1,2})[-/](\d{1,2})\b/);
  const md = text.match(/\b(\d{1,2})[-/](\d{1,2})\b/);
  if (iso || md) {
    const day = Number(iso ? iso[2] : md[2]);
    if (day >= 1 && day <= LAST) {
      return { from: d(day), to: d(day), label: `${d(day)} SGT`, predicate: betweenPredicate(d(day), d(day)) };
    }
  }

  // Chinese New Year (16 Feb half-day eve, 17–18 public holidays)
  if (/\bcny\b|chinese new year|lunar new year/.test(text)) {
    if (/week/.test(text)) return { from: d(16), to: d(22), label: "CNY week (16–22 Feb)", predicate: betweenPredicate(d(16), d(22)) };
    return { from: d(16), to: d(18), label: "Chinese New Year (16–18 Feb)", predicate: betweenPredicate(d(16), d(18)) };
  }
  if (/valentine/.test(text)) return { from: d(14), to: d(14), label: "Valentine's Day (14 Feb)", predicate: betweenPredicate(d(14), d(14)) };

  // week-of-month
  const weeks = { first: [1, 7], second: [8, 14], third: [15, 21], fourth: [22, 28], last: [22, 28] };
  for (const [k, [a, b]] of Object.entries(weeks)) {
    if (new RegExp(`\\b${k}\\s+week\\b`).test(text)) {
      return { from: d(a), to: d(b), label: `${k} week of Feb (${d(a)}–${d(b)})`, predicate: betweenPredicate(d(a), d(b)) };
    }
  }

  // weekend / school-day (weekday)
  if (/\bweekend/.test(text)) {
    return { from: d(1), to: d(LAST), label: "February weekends", predicate: `${betweenPredicate(d(1), d(LAST))} AND toDayOfWeek(txn_date) IN (6, 7)` };
  }
  if (/\b(weekday|school day|school-day)/.test(text)) {
    return { from: d(1), to: d(LAST), label: "February weekdays (school days)", predicate: `${betweenPredicate(d(1), d(LAST))} AND toDayOfWeek(txn_date) BETWEEN 1 AND 5` };
  }

  // named weekday -> every matching Feb date
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const wi = days.findIndex((name) => text.includes(name));
  if (wi >= 0) {
    const want = wi + 1; // Mon=1..Sun=7
    const matches = [];
    for (let day = 1; day <= LAST; day++) if (isodow(day) === want) matches.push(day);
    return {
      from: d(matches[0]), to: d(matches[matches.length - 1]),
      label: `Every ${days[wi]} in Feb (${matches.map(d).join(", ")})`,
      predicate: `${betweenPredicate(d(matches[0]), d(matches[matches.length - 1]))} AND toDayOfWeek(txn_date) = ${want}`,
      dates: matches.map(d),
    };
  }

  return whole; // "february" / "whole month" / anything unrecognised
}
