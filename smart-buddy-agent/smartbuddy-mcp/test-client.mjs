// Local smoke test: drives smartbuddy-mcp over the real MCP StreamableHTTP protocol.
// Run the server first (npm start), then: node test-client.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ENDPOINT = process.env.MCP_URL || "http://localhost:3501/mcp";
const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT));

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  console.log(`\n=== ${name}(${JSON.stringify(args)}) ===`);
  console.log(text.length > 900 ? text.slice(0, 900) + " …[truncated]" : text);
  return text;
}

await call("get_server_time");
await call("resolve_time_range", { text: "CNY week" });
await call("list_tables");
await call("describe_table", { table: "feb_heart_rate" });
await call("run_sql", { sql: "SELECT sc.mcat, count(*) AS txns, round(sum(t.amount)/100.0,2) AS revenue_sgd FROM tx t JOIN stallcat sc USING (schoolId, storeId) GROUP BY sc.mcat ORDER BY txns DESC" });
// PII: cardId must come back as an 'sb_' salted-hash token, never a real card number
await call("run_sql", { sql: "SELECT cardId, count(*) AS txns FROM tx GROUP BY cardId ORDER BY txns DESC LIMIT 2" });
// hardening checks — these MUST be rejected
await call("run_sql", { sql: "DROP TABLE feb_txn" });
await call("run_sql", { sql: "SELECT * FROM read_csv('/etc/hostname')" });
await call("run_sql", { sql: "SELECT 1; SELECT 2" });

await client.close();
console.log("\nSMOKE OK");
