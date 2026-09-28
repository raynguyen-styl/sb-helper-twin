# OneMap basemap fix — portable prompt for other map projects

Carto's CDN (`basemaps.cartocdn.com`) now serves "API KEY REQUIRED" watermark tiles to keyless
callers. This repo was fixed in `8a5d7df` (Carto → OneMap Grey). To apply the same fix to another
STYL map project, open a Claude Code session in that repo and paste the prompt below.

---

````markdown
## Task: replace the Carto basemap with OneMap (keyless)

**Background.** `basemaps.cartocdn.com` now requires an API key. Without one it still
returns HTTP 200, but every tile is a ~2 KB "API KEY REQUIRED" watermark image, so maps
show the watermark instead of streets. The fix, already shipped in smart-buddy-data
(commit 8a5d7df), is to switch to OneMap, the Singapore Land Authority (SLA) map tiles.
They need no key and are free for commercial use under OneMap's Terms of Use, but the
OneMap logo and credit line are **mandatory**.

**Rules.** Follow the ponytail skill: make the smallest change in the right place. Read
first, and ask me before guessing. Do not commit or push until I say so.

### 1. Find every Carto usage (don't stop at the first match)
```
grep -rn -i "cartocdn\|basemaps\.carto\|carto.com\|positron\|dark_matter\|dark_all\|light_all\|voyager" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build .
```
Also check the HTML files, style JSONs, env files and docs. List each place it's used
(file:line, map library, which Carto style) and show me the list before editing.

**Stop and ask me** in any of these cases:
- the map covers anywhere outside Singapore (OneMap only has tiles for Singapore);
- it's a Carto *vector* style with custom layers on top;
- it's in a library not listed below.

For a non-Singapore map, the keyless alternative is OpenFreeMap:
`style: 'https://tiles.openfreemap.org/styles/positron'` (MapLibre).

### 2. Pick the matching OneMap style
| Carto style | OneMap style |
|---|---|
| `light_all` / `light_nolabels` / Positron | `Grey` |
| `dark_all` / Dark Matter | `Night` |
| `rastertiles/voyager` / Voyager | `Default` |

Tile URL: `https://www.onemap.gov.sg/maps/tiles/<Style>/{z}/{x}/{y}.png`. Tiles are 256 px
PNGs with **no `@2x`** and no `{s}` subdomains, and exist only at **zoom 11–19**.

### 3. Required credit (OneMap's official text)
```html
<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" style="height:20px;width:20px;vertical-align:middle" alt="OneMap"> <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a> ©2026 contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener">Singapore Land Authority</a>
```
If the map currently hides the credit (`attributionControl: false`, or it's removed via
CSS), turn it back on. Compact mode is fine.

### 4. Edit patterns
**MapLibre / Mapbox GL, inline raster style:**
```js
attributionControl: { compact: true },   // OneMap terms require the SLA attribution
style: { version: 8,
  sources: { onemap: { type: 'raster',
    tiles: ['https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png'],
    tileSize: 256, minzoom: 11, maxzoom: 19, attribution: '<ATTRIBUTION_HTML>' } },
  layers: [{ id: 'onemap', type: 'raster', source: 'onemap' }] },
minZoom: 11,   // no OneMap tiles below z11
```
If the style is a Carto URL string (such as `.../gl/positron-gl-style/style.json`),
replace it with the inline style above.

**Leaflet:**
```js
L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png',
  { minZoom: 11, maxZoom: 19, attribution: '<ATTRIBUTION_HTML>' }).addTo(map);
```
Remove any `subdomains`, `{r}` or `detectRetina` options that belong to Carto.

**OpenLayers:**
`new ol.source.XYZ({ url: '…/Grey/{z}/{x}/{y}.png', minZoom: 11, maxZoom: 19, attributions: '<ATTRIBUTION_HTML>' })`
and set `minZoom: 11` on the View.

In every case, check the map's starting zoom. If it's below 11, raise it to 11.

**Stop over-dragging into white (do this too).** OneMap's coverage shrinks at higher zoom
(nothing north of lat 1.494 from z12; open-sea tiles are skipped from ~z16). For MapLibre, add
`maxBounds: [[103.58, 1.12], [104.16, 1.494]]` to the map and put a sea-grey background layer
*under* the raster: `{ id: 'sea', type: 'background', paint: { 'background-color': '#d1d1d1' } }`.
Leaflet: `maxBounds` with the same corners (as `[[lat, lng], …]`) and `maxBoundsViscosity: 1`,
plus `background: #d1d1d1` on the map container. For the `Night` style, sample its sea colour instead.

**Optional, if markers are hard to see:** wash the basemap out (MapLibre raster layer paint:
`'raster-saturation': -1, 'raster-brightness-min': 0.25, 'raster-contrast': -0.2`) and give
markers a thin dark ring (`box-shadow: 0 0 0 1px rgba(0,0,0,.55)`). Ask me first. It changes the look.

### 5. Things that silently break the fix
- **Content Security Policy** (nginx `add_header`, a `<meta http-equiv>` tag, helmet, or
  similar): allow `https://www.onemap.gov.sg` in `img-src`. For MapLibre, also allow it in
  `connect-src`, because MapLibre fetches tiles with fetch/XHR.
- **Service workers or offline caches** that pre-cache Carto URLs.
- **Docs:** README / DEPLOY notes that say "Carto". Update them to say OneMap.

### 6. Verify, then report
- Run `curl -s -o /dev/null -w "%{http_code} %{size_download}\n" https://www.onemap.gov.sg/maps/tiles/Grey/12/3228/2032.png`.
  Expect `200` and roughly 15–25 KB. About 2 KB would mean a watermark or empty tile.
- Build the project (or run its dev server) and confirm there are no errors.
- Report back with:
  - the diff;
  - anything you skipped;
  - a reminder that OneMap may start charging or cut off access (it's "free for now",
    with no service guarantee), so legal should confirm before production.

Then wait for my go-ahead to commit.
````

---

**Licensing summary (checked 28 Sep 2026; not legal advice).** Sources:
[Terms of Use](https://www.onemap.gov.sg/legal/termsofuse.html) ·
[API Terms of Service](https://www.onemap.gov.sg/legal/apitermsofservice.html) ·
[Grey map docs](https://www.onemap.gov.sg/docs/maps/grey.html)

- **Cost:** no charge *currently*, but SLA reserves the right to introduce one at any time.
- **Commercial use:** allowed ("royalty-free, revocable licence … for any usage").
- **Key or sign-up:** none needed for XYZ tiles. Sign-up only applies to the developer APIs.
- **Credit line:** mandatory. The OneMap logo and credit text must be shown (§3 above).
- **Restrictions:** no storing, re-hosting or redistributing tiles; live browser fetches are fine.
  No service guarantee, and access can be revoked without notice.
- Have legal confirm before production. Good enough for presales demos.
