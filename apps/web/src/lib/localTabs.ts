// Tabs this browser opened from the hero, kept locally so the owner can still refund one after its
// timeout even if the server forgets it (free hosting wipes its disk) or is down.
import type { Net } from '../config';

export interface LocalTab {
  net: Net; txid: string; vout: number; timeout: number; budget: string;
  ownerPub: string; agentPub: string; providerPub: string; at: string;
}
const KEY = 'agenttab.my-tabs';

function all(): LocalTab[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveLocalTab(t: LocalTab) {
  const rest = all().filter((x) => !(x.txid === t.txid && x.vout === t.vout));
  try { localStorage.setItem(KEY, JSON.stringify([t, ...rest].slice(0, 20))); } catch { /* storage blocked */ }
}
export const localTabs = (net: Net, ownerPub: string) => all().filter((t) => t.net === net && t.ownerPub === ownerPub.toLowerCase());
