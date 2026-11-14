#!/usr/bin/env node
// AgentTab MCP server (stdio). Lets an AI agent pay for HTTP APIs that answer 402 `bch-credit`.
// Env: AGENT_WIF (required; testnet WIF on chipnet), NETWORK=chipnet|mainnet (mainnet needs ALLOW_MAINNET=1),
//      MAX_BUDGET_SATS (20000), MAX_PRICE_SATS (5000), MAX_TOTAL_SATS (100000), TAB_BLOCKS (144),
//      AGENTTAB_STATE (state file path). Reads ./.env at the repo root as a fallback.
import { existsSync, readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ElectrumNetworkProvider } from 'cashscript';
import { decodePrivateKeyWif } from '@bitauth/libauth';
import { AgentTabClient } from './agent.ts';

const root = new URL('../../../', import.meta.url);
const dotenv = existsSync(new URL('.env', root))
  ? Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
  : {};
const env: Record<string, string | undefined> = { ...dotenv, ...process.env };

const network = (env.NETWORK ?? 'chipnet') as 'chipnet' | 'mainnet';
if (network === 'mainnet' && env.ALLOW_MAINNET !== '1') throw new Error('NETWORK=mainnet requires ALLOW_MAINNET=1');
if (network !== 'chipnet' && network !== 'mainnet') throw new Error(`unknown NETWORK ${network}`);
const dec = decodePrivateKeyWif(env.AGENT_WIF ?? '');
if (typeof dec === 'string') throw new Error(`AGENT_WIF: ${dec}`);
if ((network === 'mainnet') !== (dec.type === 'mainnet')) throw new Error(`AGENT_WIF network does not match ${network}`);

const agent = new AgentTabClient({
  agentPriv: dec.privateKey,
  network,
  provider: new ElectrumNetworkProvider(network),
  maxBudgetSats: BigInt(env.MAX_BUDGET_SATS ?? 20_000),
  maxPriceSats: BigInt(env.MAX_PRICE_SATS ?? 5_000),
  maxTotalSats: BigInt(env.MAX_TOTAL_SATS ?? 100_000),
  tabBlocks: Number(env.TAB_BLOCKS ?? 144),
  stateFile: env.AGENTTAB_STATE ?? new URL(`.data/mcp-${network}.json`, root).pathname,
});

const text = (o: unknown) => ({ content: [{ type: 'text' as const, text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: (e as Error).message ?? String(e) }] });

const server = new McpServer({ name: 'agenttab', version: '0.1.0' });

server.registerTool('agent_info', {
  title: 'AgentTab: agent wallet info',
  description: 'Shows this agent\'s public key (give it to a human to fund a tab for you), its own funding address, balance, network and spending caps.',
  inputSchema: {},
}, async () => {
  try {
    return text({
      network, agentPub: agent.agentPubHex, fundingAddress: agent.address, balanceSats: (await agent.balance()).toString(),
      caps: { maxBudgetSats: env.MAX_BUDGET_SATS ?? '20000', maxPriceSats: env.MAX_PRICE_SATS ?? '5000', maxTotalSats: env.MAX_TOTAL_SATS ?? '100000' },
      totalSignedSats: agent.totalSigned().toString(),
    });
  } catch (e) { return fail(e); }
});

server.registerTool('fetch_paid', {
  title: 'AgentTab: fetch a paid URL',
  description: 'Fetch a URL. If the server answers HTTP 402 with a `bch-credit` offer, pay for this one call in Bitcoin Cash from a covenant tab (a human-funded tab for this agent, or one opened from the agent\'s own funds under the budget cap) and return the paid response.',
  inputSchema: {
    url: z.string().url().describe('URL to fetch'),
    method: z.enum(['GET', 'POST']).optional().describe('HTTP method (default GET)'),
    body: z.string().optional().describe('Request body for POST'),
    max_price_sats: z.number().int().positive().optional().describe('Refuse if a single call costs more than this'),
  },
}, async ({ url, method, body, max_price_sats }) => {
  try {
    const r = await agent.fetchPaid(url, { method: method ?? 'GET', body }, max_price_sats ? BigInt(max_price_sats) : undefined);
    return text(r);
  } catch (e) { return fail(e); }
});

server.registerTool('tab_status', {
  title: 'AgentTab: tab status',
  description: 'Budget, amount signed so far, remaining, timeout and provider-side status for this agent\'s tabs.',
  inputSchema: { tab: z.string().optional().describe('txid:vout; omit for all tabs') },
}, async ({ tab }) => {
  try { return text(await agent.status(tab)); } catch (e) { return fail(e); }
});

server.registerTool('close_tab', {
  title: 'AgentTab: close a tab',
  description: 'Close a tab: asks the provider to settle on-chain now (provider gets what was signed, the rest returns to the owner). If the timeout has passed and the agent funded the tab itself, refunds it instead.',
  inputSchema: { tab: z.string().describe('txid:vout') },
}, async ({ tab }) => {
  try { return text(await agent.close(tab)); } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
