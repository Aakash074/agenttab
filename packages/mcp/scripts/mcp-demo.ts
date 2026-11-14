// Drives the AgentTab MCP server over stdio like an AI client would, against a local paywall on chipnet.
// Usage: node packages/mcp/scripts/mcp-demo.ts [serverUrl] [calls]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const base = process.argv[2] ?? 'http://localhost:8402';
const calls = Number(process.argv[3] ?? 3);
const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../src/index.ts', import.meta.url).pathname], env: { ...process.env } as Record<string, string> });
const client = new Client({ name: 'agenttab-demo', version: '0.1.0' });
await client.connect(transport);
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] };
  const out = r.content[0].text;
  if (r.isError) throw new Error(`${name}: ${out}`);
  try { return JSON.parse(out); } catch { return out; }
};
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('agent_info:', await call('agent_info'));
let tab = '';
for (let i = 1; i <= calls; i++) {
  const r = await call('fetch_paid', { url: `${base}/api/oracle?q=mcp-call-${i}` });
  tab = r.tab;
  console.log(`fetch_paid #${i}: status=${r.status} tab=${r.tab} paid=${r.priceSats} total=${r.cumulativeSats} remaining=${r.remainingSats} :: ${JSON.parse(r.body).answer}`);
}
console.log('tab_status:', await call('tab_status', { tab }));
console.log('close_tab:', await call('close_tab', { tab }));
await client.close();
