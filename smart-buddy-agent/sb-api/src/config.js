// sb-api config — env + InfluxDB client. Clone of tree-digital-twin/nparks-api/src/config.js,
// trimmed to what the SMART Buddy read API needs (no forecast/SAM/reset).
import 'dotenv/config';
import { InfluxDB } from '@influxdata/influxdb-client';

// InfluxDB — SMART Buddy history lives in the SHARED `rtls` bucket under `sb_*` measurements.
export const INFLUX_URL = (process.env.INFLUX_URL || 'http://localhost:8086').replace(/\/$/, '');
export const INFLUX_TOKEN = (process.env.INFLUX_TOKEN || '').trim();
export const INFLUX_ORG = process.env.INFLUX_ORG || 'styl';
export const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'rtls';

// Ditto — current-state twins in the `org.smartbuddy` namespace.
export const DITTO_BASE_URL = (process.env.DITTO_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');
export const DITTO_USERNAME = process.env.DITTO_USERNAME || 'ditto';
export const DITTO_PASSWORD = process.env.DITTO_PASSWORD || 'ditto';
export const DITTO_NAMESPACE = process.env.DITTO_NAMESPACE || 'org.smartbuddy';

export const SB_API_PORT = Number(process.env.SB_API_PORT) || 3320;  // avoids tree-twin's 3310
export const SB_API_KEY = (process.env.SB_API_KEY || '').trim();      // optional Bearer on /api

// Fixed playback window (Feb 2026). Range defaults when the client omits from/to.
export const POC_START = process.env.POC_START || '2026-02-01';
export const POC_END = process.env.POC_END || '2026-02-28';

export const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
export const queryApi = influx.getQueryApi(INFLUX_ORG);
