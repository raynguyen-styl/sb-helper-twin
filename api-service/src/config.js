// sb-api config — the SMART Buddy read API. Serves the dashboard's Playback window from the shared
// ClickHouse `smartbuddy` database (the SAME store the SAM agent uses), as the READ-ONLY user. There
// is NO InfluxDB or Ditto here anymore: February is a fixed month, so one OLAP store serves both the
// playback series (via sb-api) and the agent's analytical SQL (via smartbuddy-mcp).
import 'dotenv/config';
import { createClient } from '@clickhouse/client';

export const CLICKHOUSE_URL = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/$/, '');
export const CLICKHOUSE_DB = (process.env.CLICKHOUSE_DB || 'smartbuddy').trim();
export const CLICKHOUSE_USER = (process.env.CLICKHOUSE_USER || 'smartbuddy_ro').trim();
export const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';

export const SB_API_PORT = Number(process.env.SB_API_PORT) || 3320;
export const SB_API_KEY = (process.env.SB_API_KEY || '').trim();      // optional Bearer on /api

export const ch = createClient({
  url: CLICKHOUSE_URL,
  username: CLICKHOUSE_USER,
  password: CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DB,
  clickhouse_settings: {
    readonly: 2,                                   // read-only data (belt-and-suspenders with the SELECT-only grant)
    max_execution_time: 30,
    // return 64-bit ints as JSON numbers, not strings, so the browser charts them directly
    output_format_json_quote_64bit_integers: 0,
  },
});
