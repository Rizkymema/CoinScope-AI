/**
 * Smart wallets: tokens currently held by wallets the user follows (KOLs and top-PnL traders
 * copied from the GMGN / Axiom / kolscan leaderboards). The scanner uses it two ways:
 *
 *   discovery     tokens several tracked wallets hold join the candidate list - copying what top
 *                 traders are accumulating instead of what is already trending
 *   confirmation  each signal shows how many tracked wallets hold it, which adds social score
 *
 * Holdings come from token accounts with a non-zero balance, so a wallet that has sold out no
 * longer counts. Spam gets airdropped into famous wallets too: the scanner's liquidity, volume and
 * RugCheck gates keep that out, not this list.
 */
import { base58Encode } from '../lib/base58';
import { rpc, RPC_PROXY } from './wallet.service';

const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const HOLDINGS_TTL_MS = 10 * 60_000;
/** Most tracked wallets the scanner reads; each costs two RPC calls per refresh. */
export const MAX_SMART_WALLETS = 15;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isSolanaAddress = (s: string) => SOLANA_ADDRESS.test(s.trim());

const holdingsMemo = new Map<string, { at: number; mints: string[] }>();

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Mints `wallet` holds a non-zero balance of; null when the RPC did not answer. */
async function holdingsOf(wallet: string): Promise<string[] | null> {
  const hit = holdingsMemo.get(wallet);
  if (hit && Date.now() - hit.at < HOLDINGS_TTL_MS) return hit.mints;
  const mints = new Set<string>();
  try {
    for (const programId of TOKEN_PROGRAMS) {
      // Only mint (bytes 0-32) and amount (64-72) are needed; slicing keeps a wallet with
      // thousands of token accounts to a few hundred KB.
      const res = await rpc<{ value: { account: { data: [string, string] } }[] }>(RPC_PROXY, 'getTokenAccountsByOwner', [
        wallet,
        { programId },
        { encoding: 'base64', dataSlice: { offset: 0, length: 72 }, commitment: 'confirmed' },
      ]);
      (res?.value || []).forEach(({ account }) => {
        const bytes = decode(account.data[0]);
        if (bytes.length < 72 || bytes.subarray(64, 72).every((b) => b === 0)) return;
        mints.add(base58Encode(bytes.subarray(0, 32)));
      });
    }
  } catch {
    return hit?.mints ?? null;
  }
  const list = [...mints];
  holdingsMemo.set(wallet, { at: Date.now(), mints: list });
  return list;
}

export const SmartWalletService = {
  /** mint -> the tracked wallets that hold it. Wallets are read one after another to spare the RPC proxy. */
  async holdings(wallets: string[]): Promise<Map<string, string[]>> {
    const byMint = new Map<string, string[]>();
    for (const wallet of wallets.filter(isSolanaAddress).slice(0, MAX_SMART_WALLETS)) {
      const mints = await holdingsOf(wallet);
      (mints || []).forEach((m) => byMint.set(m, [...(byMint.get(m) || []), wallet]));
    }
    return byMint;
  },
};
