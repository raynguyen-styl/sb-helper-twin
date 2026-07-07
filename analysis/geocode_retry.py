"""Retry geocoding for schools still missing lat/lng, slow pace + backoff."""
import json, time, urllib.request

geo = json.load(open("school_geo.json"))
todo = sorted({v["postal"] for v in geo.values() if v["lat"] is None})
print("to geocode:", len(todo), flush=True)

pc2ll = {}
for i, pc in enumerate(todo):
    url = f"https://www.onemap.gov.sg/api/common/elastic/search?searchVal={pc}&returnGeom=Y&getAddrDetails=Y&pageNum=1"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20) as f:
                d = json.load(f)
            res = d.get("results", [])
            if res:
                pc2ll[pc] = (float(res[0]["LATITUDE"]), float(res[0]["LONGITUDE"]))
            break
        except Exception as e:
            wait = 3 * (attempt + 1)
            if "429" not in str(e) and attempt >= 2:
                print("fail", pc, e, flush=True)
                break
            time.sleep(wait)
    time.sleep(1.4)
    if i % 20 == 0:
        print(i, "done,", len(pc2ll), "ok", flush=True)

for sid, v in geo.items():
    if v["lat"] is None and v["postal"] in pc2ll:
        v["lat"], v["lng"] = pc2ll[v["postal"]]
json.dump(geo, open("school_geo.json", "w"), indent=1)
missing = [s for s, v in geo.items() if v["lat"] is None]
print("DONE. still missing:", len(missing), missing[:20])
