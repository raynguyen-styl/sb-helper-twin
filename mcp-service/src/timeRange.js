// Map a natural-language date phrase onto exact dates (SGT) within the two dataset months
// (February 2026 or March 2026). The dataset is fixed history, so "today"/"now" are meaningless.
// Returns date strings + a ready-to-paste SQL predicate that ALWAYS pins the `month` column
// (ClickHouse dialect; the txn_date range is also usable as a template for other tables).

const pad = (n) => String(n).padStart(2, "0");

export function resolveTimeRange(textRaw) {
  const text = String(textRaw || "").toLowerCase().trim();
  // CNY is a February event; otherwise honour an explicit March, else default to February.
  const cny = /\bcny\b|chinese new year|lunar new year/.test(text);
  const mar = !cny && (/march|2026-03/.test(text) || /\bmar\b/.test(text));
  const M = mar ? 3 : 2, LAST = mar ? 31 : 28, mkey = `2026-0${M}`, MNAME = mar ? "March" : "February";
  const d = (day) => `${mkey}-${pad(day)}`;
  const isodow = (day) => (((new Date(Date.UTC(2026, M - 1, day)).getUTCDay()) + 6) % 7) + 1;
  const pred = (from, to, extra = "") =>
    `month = '${mkey}' AND txn_date BETWEEN toDate('${from}') AND toDate('${to}')${extra}`;

  const whole = { month: mkey, from: d(1), to: d(LAST), label: `all of ${MNAME} 2026`, predicate: pred(d(1), d(LAST)) };
  if (!text) return whole;

  // explicit YYYY-MM-DD or MM-DD / M-D (clamped into the resolved month)
  const iso = text.match(/\b20\d{2}[-/](\d{1,2})[-/](\d{1,2})\b/);
  const md = text.match(/\b(\d{1,2})[-/](\d{1,2})\b/);
  if (iso || md) {
    const day = Number(iso ? iso[2] : md[2]);
    if (day >= 1 && day <= LAST) {
      return { month: mkey, from: d(day), to: d(day), label: `${d(day)} SGT`, predicate: pred(d(day), d(day)) };
    }
  }

  // Chinese New Year (16 Feb half-day eve, 17–18 public holidays) — always February
  if (cny) {
    if (/week/.test(text)) return { month: mkey, from: d(16), to: d(22), label: "CNY week (16–22 Feb)", predicate: pred(d(16), d(22)) };
    return { month: mkey, from: d(16), to: d(18), label: "Chinese New Year (16–18 Feb)", predicate: pred(d(16), d(18)) };
  }
  if (/valentine/.test(text)) return { month: mkey, from: d(14), to: d(14), label: "Valentine's Day (14 Feb)", predicate: pred(d(14), d(14)) };

  // week-of-month
  const weeks = { first: [1, 7], second: [8, 14], third: [15, 21], fourth: [22, 28], last: [Math.max(1, LAST - 6), LAST] };
  for (const [k, [a, b]] of Object.entries(weeks)) {
    if (new RegExp(`\\b${k}\\s+week\\b`).test(text)) {
      return { month: mkey, from: d(a), to: d(b), label: `${k} week of ${MNAME} (${d(a)}–${d(b)})`, predicate: pred(d(a), d(b)) };
    }
  }

  // weekend / school-day (weekday)
  if (/\bweekend/.test(text)) {
    return { month: mkey, from: d(1), to: d(LAST), label: `${MNAME} weekends`, predicate: pred(d(1), d(LAST), " AND toDayOfWeek(txn_date) IN (6, 7)") };
  }
  if (/\b(weekday|school day|school-day)/.test(text)) {
    return { month: mkey, from: d(1), to: d(LAST), label: `${MNAME} weekdays (school days)`, predicate: pred(d(1), d(LAST), " AND toDayOfWeek(txn_date) BETWEEN 1 AND 5") };
  }

  // named weekday -> every matching date in the month
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const wi = days.findIndex((name) => text.includes(name));
  if (wi >= 0) {
    const want = wi + 1; // Mon=1..Sun=7
    const matches = [];
    for (let day = 1; day <= LAST; day++) if (isodow(day) === want) matches.push(day);
    return {
      month: mkey, from: d(matches[0]), to: d(matches[matches.length - 1]),
      label: `Every ${days[wi]} in ${MNAME} (${matches.map(d).join(", ")})`,
      predicate: pred(d(matches[0]), d(matches[matches.length - 1]), ` AND toDayOfWeek(txn_date) = ${want}`),
      dates: matches.map(d),
    };
  }

  return whole; // "february" / "march" / "whole month" / anything unrecognised
}
