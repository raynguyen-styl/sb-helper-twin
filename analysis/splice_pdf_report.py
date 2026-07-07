"""Splice Chart.js + appdata/{global,schools}.json into pdf_report.html ->
scratch HTML, then print SMART_Buddy_Findings_Report.pdf via headless Chrome
(run chrome manually; this script only writes the spliced HTML next to the template)."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
tpl = open(os.path.join(HERE, "pdf_report.html"), encoding="utf-8").read()
g = open(os.path.join(HERE, "appdata", "global.json"), encoding="utf-8").read()
s = open(os.path.join(HERE, "appdata", "schools.json"), encoding="utf-8").read()
chart = open(os.path.join(ROOT, "smart-buddy-app", "node_modules", "chart.js", "dist",
                          "chart.umd.min.js"), encoding="utf-8").read()

out = (tpl.replace("/*__CHARTJS__*/", chart)
          .replace("/*__DATA__*/{}", g)
          .replace("/*__SCHOOLS__*/{}", s))
dest = os.path.join(HERE, "pdf_report_spliced.html")
open(dest, "w", encoding="utf-8").write(out)
print("WROTE", dest, os.path.getsize(dest) // 1024, "KB")
