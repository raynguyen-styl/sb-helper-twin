"""Splice Chart.js + feb_service.json into feb_service_report.html ->
../SMART_Buddy_Feb2026_Service_Report.html (self-contained). Then print to PDF via Chrome."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
tpl = open(os.path.join(HERE, "feb_service_report.html"), encoding="utf-8").read()
data = open(os.path.join(HERE, "feb_service.json"), encoding="utf-8").read()
chart = open(os.path.join(ROOT, "smart-buddy-app", "node_modules", "chart.js", "dist",
                         "chart.umd.min.js"), encoding="utf-8").read()

out = tpl.replace("/*__CHARTJS__*/", chart).replace("/*__DATA__*/{}", data)
dest = os.path.join(ROOT, "SMART_Buddy_Feb2026_Service_Report.html")
open(dest, "w", encoding="utf-8").write(out)
print("WROTE", dest, os.path.getsize(dest) // 1024, "KB")
