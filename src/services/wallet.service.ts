/**
 * Solana browser-wallet service (Phantom / Solflare) + JSON-RPC helpers.
 * Non-custodial: private keys never leave the wallet extension. We only build
 * transactions and hand them to the wallet for signing + broadcasting.
 */
import { PublicKey, SystemProgram, VersionedTransaction, Transaction, TransactionMessage } from '@solana/web3.js';

/**
 * The browser talks to Solana through our own /api/rpc proxy by default. The public mainnet
 * endpoint answers browser requests with 403, so calling it directly from the dashboard breaks
 * balances and transaction confirmations. A custom endpoint (e.g. a Helius URL) is still used
 * directly when configured, with the proxy as its fallback.
 */
export const RPC_PROXY = '/api/rpc';
export const DEFAULT_SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || RPC_PROXY;

/** Endpoints known to refuse browser traffic - silently rerouted through the proxy. */
const BROWSER_BLOCKED = ['api.mainnet-beta.solana.com'];

export function resolveRpcUrl(url?: string | null): string {
  const u = (url || '').trim();
  if (!u) return RPC_PROXY;
  if (BROWSER_BLOCKED.some((h) => u.includes(h))) return RPC_PROXY;
  return u;
}
export const LAMPORTS_PER_SOL = 1_000_000_000;

export type WalletProviderType = 'phantom' | 'solflare';

export interface WalletConnectResult {
  success: boolean;
  address?: string;
  solBalance?: number;
  walletType?: WalletProviderType;
  message?: string;
}

export interface TokenBalance {
  mint: string;
  amountRaw: string;
  uiAmount: number;
  decimals: number;
}

interface SolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: { toString(): string } | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(
    tx: VersionedTransaction | Transaction,
    opts?: { skipPreflight?: boolean; maxRetries?: number }
  ): Promise<{ signature: string }>;
  signTransaction?(tx: VersionedTransaction | Transaction): Promise<VersionedTransaction | Transaction>;
  on?(event: string, handler: (...args: any[]) => void): void;
  off?(event: string, handler: (...args: any[]) => void): void;
}

function getProvider(preferred?: WalletProviderType): { provider: SolanaProvider; type: WalletProviderType } | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  const phantom: SolanaProvider | undefined = w.phantom?.solana || (w.solana?.isPhantom ? w.solana : undefined);
  const solflare: SolanaProvider | undefined = w.solflare?.isSolflare ? w.solflare : undefined;

  if (preferred === 'solflare' && solflare) return { provider: solflare, type: 'solflare' };
  if (preferred === 'phantom' && phantom) return { provider: phantom, type: 'phantom' };
  if (phantom) return { provider: phantom, type: 'phantom' };
  if (solflare) return { provider: solflare, type: 'solflare' };
  return null;
}

/** Network / HTTP failure, as opposed to the RPC node answering with an error about the request. */
class RpcTransportError extends Error {}

async function rpcOnce<T>(url: string, method: string, params: unknown[]): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch (err: any) {
    throw new RpcTransportError(`RPC ${method} unreachable: ${err?.message || 'network error'}`);
  }
  if (!response.ok) throw new RpcTransportError(`RPC ${method} failed with HTTP ${response.status}`);
  const data = await response.json().catch(() => null);
  if (!data) throw new RpcTransportError(`RPC ${method} returned an unreadable body`);
  if (data.error) throw new Error(data.error.message || `RPC ${method} error`);
  return data.result as T;
}

/** JSON-RPC call: configured endpoint first, then the server proxy if that endpoint is unreachable. */
export async function rpc<T = any>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const primary = resolveRpcUrl(rpcUrl);
  try {
    return await rpcOnce<T>(primary, method, params);
  } catch (err) {
    if (primary === RPC_PROXY || !(err instanceof RpcTransportError)) throw err;
    return rpcOnce<T>(RPC_PROXY, method, params);
  }
}

export const WalletService = {
  isPhantomInstalled(): boolean {
    return !!getProvider('phantom');
  },

  isSolflareInstalled(): boolean {
    return !!getProvider('solflare');
  },

  getInstalledWallets(): WalletProviderType[] {
    const out: WalletProviderType[] = [];
    if (this.isPhantomInstalled()) out.push('phantom');
    if (this.isSolflareInstalled()) out.push('solflare');
    return out;
  },

  /** Connects to Phantom (default) or Solflare. `silent` reconnects a previously trusted wallet without a popup. */
  async connect(
    rpcUrl = DEFAULT_SOLANA_RPC,
    preferred?: WalletProviderType,
    silent = false
  ): Promise<WalletConnectResult> {
    const found = getProvider(preferred);
    if (!found) {
      if (!silent && typeof window !== 'undefined') window.open('https://phantom.app/download', '_blank');
      return {
        success: false,
        message: 'No Solana wallet extension detected. Install Phantom (phantom.app) or Solflare and reload.',
      };
    }

    try {
      const response = await found.provider.connect(silent ? { onlyIfTrusted: true } : undefined);
      const publicKey = response.publicKey.toString();
      const solBalance = await this.getSolBalance(publicKey, rpcUrl);
      return {
        success: true,
        address: publicKey,
        solBalance: solBalance ?? 0,
        walletType: found.type,
        message: `Connected ${found.type} wallet ${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`,
      };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Wallet connection was rejected.' };
    }
  },

  /** Kept for backwards compatibility with older call sites. */
  async connectPhantom(rpcUrl = DEFAULT_SOLANA_RPC): Promise<WalletConnectResult> {
    return this.connect(rpcUrl, 'phantom');
  },

  async disconnect(): Promise<void> {
    const found = getProvider();
    if (!found) return;
    try {
      await found.provider.disconnect();
    } catch {
      // ignore
    }
  },

  async disconnectPhantom(): Promise<void> {
    return this.disconnect();
  },

  /** Subscribes to account switches / disconnects inside the wallet extension. */
  onAccountChange(handler: (address: string | null) => void): () => void {
    const found = getProvider();
    if (!found?.provider.on) return () => {};
    const onChange = (pk: any) => handler(pk ? pk.toString() : null);
    const onDisconnect = () => handler(null);
    found.provider.on('accountChanged', onChange);
    found.provider.on('disconnect', onDisconnect);
    return () => {
      found.provider.off?.('accountChanged', onChange);
      found.provider.off?.('disconnect', onDisconnect);
    };
  },

  /** Live SOL balance. Returns null when the RPC call fails so callers never show a fake number. */
  async getSolBalance(address: string, rpcUrl = DEFAULT_SOLANA_RPC): Promise<number | null> {
    try {
      const result = await rpc<{ value: number }>(rpcUrl, 'getBalance', [address, { commitment: 'confirmed' }]);
      return typeof result?.value === 'number' ? result.value / LAMPORTS_PER_SOL : null;
    } catch {
      return null;
    }
  },

  /** SPL token balance for a single mint (sums all token accounts; supports Token-2022). */
  async getTokenBalance(owner: string, mint: string, rpcUrl = DEFAULT_SOLANA_RPC): Promise<TokenBalance | null> {
    try {
      const result = await rpc<{ value: any[] }>(rpcUrl, 'getTokenAccountsByOwner', [
        owner,
        { mint },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ]);
      const accounts = result?.value || [];
      if (accounts.length === 0) return { mint, amountRaw: '0', uiAmount: 0, decimals: 0 };
      let raw = BigInt(0);
      let decimals = 0;
      let ui = 0;
      accounts.forEach((acc) => {
        const info = acc?.account?.data?.parsed?.info?.tokenAmount;
        if (!info) return;
        raw += BigInt(info.amount || '0');
        decimals = Number(info.decimals) || decimals;
        ui += Number(info.uiAmount) || 0;
      });
      return { mint, amountRaw: raw.toString(), uiAmount: ui, decimals };
    } catch {
      return null;
    }
  },

  /** Signs and broadcasts a transaction produced by PumpPortal / Jupiter (base64 or raw bytes). */
  async signAndSendTransaction(
    serialized: string | Uint8Array,
    opts?: { skipPreflight?: boolean; maxRetries?: number }
  ): Promise<{ success: boolean; signature?: string; message?: string }> {
    const found = getProvider();
    if (!found) return { success: false, message: 'Wallet not connected.' };

    try {
      const bytes = typeof serialized === 'string' ? Uint8Array.from(atob(serialized), (c) => c.charCodeAt(0)) : serialized;
      let tx: VersionedTransaction | Transaction;
      try {
        tx = VersionedTransaction.deserialize(bytes);
      } catch {
        tx = Transaction.from(bytes);
      }
      const { signature } = await found.provider.signAndSendTransaction(tx, {
        skipPreflight: opts?.skipPreflight ?? false,
        maxRetries: opts?.maxRetries ?? 3,
      });
      return { success: true, signature, message: `Transaction sent: ${signature.slice(0, 8)}...` };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Transaction signing was cancelled.' };
    }
  },

  /** Plain SOL transfer signed in the extension - used to fund the bot wallet from Phantom. */
  async transferSol(
    from: string,
    to: string,
    amountSol: number,
    rpcUrl = DEFAULT_SOLANA_RPC
  ): Promise<{ success: boolean; signature?: string; message?: string }> {
    const found = getProvider();
    if (!found) return { success: false, message: 'Wallet not connected.' };
    try {
      const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
      if (!(lamports > 0)) return { success: false, message: 'Enter an amount above 0.' };
      const fromKey = new PublicKey(from);
      const latest = await rpc<{ value: { blockhash: string } }>(rpcUrl, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const message = new TransactionMessage({
        payerKey: fromKey,
        recentBlockhash: latest.value.blockhash,
        instructions: [SystemProgram.transfer({ fromPubkey: fromKey, toPubkey: new PublicKey(to), lamports })],
      }).compileToV0Message();
      const { signature } = await found.provider.signAndSendTransaction(new VersionedTransaction(message), { skipPreflight: false, maxRetries: 3 });
      return { success: true, signature, message: `Sent ${amountSol} SOL.` };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Transfer was cancelled.' };
    }
  },

  /**
   * Simulates a serialized (base64) transaction on the RPC without signing it.
   * Used by the live-pipeline dry run; no funds move.
   */
  async simulateTransaction(
    serializedBase64: string,
    rpcUrl = DEFAULT_SOLANA_RPC
  ): Promise<{ ok: boolean; unitsConsumed?: number; error?: string; logs?: string[] }> {
    try {
      const result = await rpc<{ value: { err: unknown; unitsConsumed?: number; logs?: string[] } }>(rpcUrl, 'simulateTransaction', [
        serializedBase64,
        { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' },
      ]);
      const v = result?.value;
      if (!v) return { ok: false, error: 'Empty simulation result' };
      if (v.err) {
        const logs = (v.logs || []).slice(-6);
        const hint = logs.find((l) => /Error|insufficient|failed/i.test(l));
        return { ok: false, error: `${typeof v.err === 'string' ? v.err : JSON.stringify(v.err)}${hint ? ` - ${hint}` : ''}`, logs };
      }
      return { ok: true, unitsConsumed: v.unitsConsumed, logs: (v.logs || []).slice(-6) };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Simulation request failed' };
    }
  },

  /**
   * Polls the RPC until the signature is confirmed, fails on-chain, or times out. The default 90s
   * outlives a blockhash (~60-80s), so a timeout means the transaction almost certainly expired.
   * `rebroadcast` re-submits the signed bytes every few seconds, which helps a lot when the
   * network is congested and the first send is dropped.
   */
  async confirmTransaction(
    signature: string,
    rpcUrl = DEFAULT_SOLANA_RPC,
    timeoutMs = 90_000,
    rebroadcast?: () => Promise<void>
  ): Promise<{ confirmed: boolean; error?: string; timedOut?: boolean }> {
    const started = Date.now();
    let polls = 0;
    while (Date.now() - started < timeoutMs) {
      try {
        const result = await rpc<{ value: (null | { confirmationStatus?: string; err: unknown })[] }>(
          rpcUrl,
          'getSignatureStatuses',
          [[signature], { searchTransactionHistory: true }]
        );
        const status = result?.value?.[0];
        if (status) {
          if (status.err) return { confirmed: false, error: `Failed on-chain: ${JSON.stringify(status.err)}` };
          if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
            return { confirmed: true };
          }
        } else if (rebroadcast && polls % 2 === 1 && Date.now() - started < 60_000) {
          rebroadcast().catch(() => {});
        }
      } catch {
        // transient RPC error - keep polling
      }
      polls++;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { confirmed: false, timedOut: true, error: `Not confirmed after ${Math.round(timeoutMs / 1000)}s` };
  },

  explorerUrl(signature: string): string {
    return `https://solscan.io/tx/${signature}`;
  },

  accountUrl(address: string): string {
    return `https://solscan.io/account/${address}`;
  },
};
