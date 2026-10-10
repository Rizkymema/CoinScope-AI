/**
 * Bot wallet: a dedicated Solana keypair kept in this browser so the bot can sign its own buys
 * and sells. Phantom asks for approval on every transaction, which makes unattended auto-entry and
 * auto-take-profit impossible; this wallet removes that prompt for the money you choose to put in it.
 *
 * Storage: the secret key is encrypted with the user's password (PBKDF2-SHA256 -> AES-GCM-256)
 * and only that ciphertext goes to localStorage. The decrypted key lives in memory while unlocked
 * and is gone after a reload or lock(). It is still a hot wallet - fund it with trading money only.
 */
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { base58Decode, base58Encode } from '../lib/base58';
import { rpc, LAMPORTS_PER_SOL } from './wallet.service';

const VAULT_KEY = 'coinscope-bot-wallet-v1';
const KDF_ITERATIONS = 310_000;
const BASE_FEE_LAMPORTS = 5_000;
export const MIN_PASSWORD_LENGTH = 8;

interface Vault {
  v: 1;
  address: string;
  salt: string;
  iv: string;
  data: string;
  iterations: number;
  createdAt: number;
  /** Set once the owner has exported the key (or imported one they already hold). */
  backedUpAt?: number;
}

export interface SendResult {
  success: boolean;
  signature?: string;
  message?: string;
  /** Re-submits the same signed bytes; used while waiting for confirmation on a congested network. */
  rebroadcast?: () => Promise<void>;
}

let keypair: Keypair | null = null;
const listeners = new Set<() => void>();
const emit = () =>
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // listener errors must not break the wallet
    }
  });

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function readVault(): Vault | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    const v = raw ? (JSON.parse(raw) as Vault) : null;
    return v && v.v === 1 && v.address && v.data ? v : null;
  } catch {
    return null;
  }
}

function writeVault(vault: Vault | null) {
  try {
    if (vault) localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
    else localStorage.removeItem(VAULT_KEY);
  } catch {
    throw new Error('Browser storage is unavailable (private window or blocked site data).');
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function seal(kp: Keypair, password: string): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, kp.secretKey as BufferSource));
  return { v: 1, address: kp.publicKey.toBase58(), salt: toB64(salt), iv: toB64(iv), data: toB64(data), iterations: KDF_ITERATIONS, createdAt: Date.now() };
}

async function openVault(vault: Vault, password: string): Promise<Keypair> {
  const key = await deriveKey(password, fromB64(vault.salt), vault.iterations || KDF_ITERATIONS);
  let secret: Uint8Array;
  try {
    secret = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) as BufferSource }, key, fromB64(vault.data) as BufferSource));
  } catch {
    throw new Error('Wrong password.');
  }
  const kp = Keypair.fromSecretKey(secret);
  if (kp.publicKey.toBase58() !== vault.address) throw new Error('Stored wallet is corrupted (address mismatch).');
  return kp;
}

/** Accepts the formats wallets export: base58 (Phantom "Export private key") or a JSON byte array (solana-keygen). */
function parseSecret(input: string): Keypair {
  const text = input.trim();
  let bytes: Uint8Array;
  try {
    bytes = text.startsWith('[') ? Uint8Array.from(JSON.parse(text) as number[]) : base58Decode(text);
  } catch {
    throw new Error('Could not read that private key. Paste the base58 string or the [..] byte array.');
  }
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error(`A Solana private key is 64 bytes; this one is ${bytes.length}.`);
}

function assertPassword(password: string) {
  if ((password || '').length < MIN_PASSWORD_LENGTH) throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
}

async function broadcast(rpcUrl: string, wire: Uint8Array, skipPreflight: boolean): Promise<string> {
  return rpc<string>(rpcUrl, 'sendTransaction', [
    toB64(wire),
    { encoding: 'base64', skipPreflight, preflightCommitment: 'confirmed', maxRetries: 2 },
  ]);
}

export const HotWallet = {
  hasVault(): boolean {
    return !!readVault();
  },

  /** Address of the stored wallet, readable while locked (it is public). */
  address(): string | null {
    return readVault()?.address ?? null;
  },

  isUnlocked(): boolean {
    return !!keypair;
  },

  /** True once the key has been exported or imported, i.e. a copy exists outside this browser. */
  isBackedUp(): boolean {
    return !!readVault()?.backedUpAt;
  },

  markBackedUp() {
    const vault = readVault();
    if (!vault || vault.backedUpAt) return;
    writeVault({ ...vault, backedUpAt: Date.now() });
    emit();
  },

  unlockedAddress(): string | null {
    return keypair ? keypair.publicKey.toBase58() : null;
  },

  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  async create(password: string): Promise<string> {
    assertPassword(password);
    if (readVault()) throw new Error('A bot wallet already exists. Remove it before creating another.');
    const kp = Keypair.generate();
    writeVault(await seal(kp, password));
    keypair = kp;
    emit();
    return kp.publicKey.toBase58();
  },

  async importSecret(secret: string, password: string): Promise<string> {
    assertPassword(password);
    if (readVault()) throw new Error('A bot wallet already exists. Remove it before importing another.');
    const kp = parseSecret(secret);
    // An imported key already exists outside this browser, so it counts as backed up.
    writeVault({ ...(await seal(kp, password)), backedUpAt: Date.now() });
    keypair = kp;
    emit();
    return kp.publicKey.toBase58();
  },

  async unlock(password: string): Promise<string> {
    const vault = readVault();
    if (!vault) throw new Error('No bot wallet stored in this browser.');
    keypair = await openVault(vault, password);
    emit();
    return keypair.publicKey.toBase58();
  },

  lock() {
    keypair = null;
    emit();
  },

  /** Base58 secret key, for importing into Phantom. Requires the password again. */
  async exportSecret(password: string): Promise<string> {
    const vault = readVault();
    if (!vault) throw new Error('No bot wallet stored in this browser.');
    const kp = await openVault(vault, password);
    this.markBackedUp();
    return base58Encode(kp.secretKey);
  },

  /** Text for a backup file the owner can keep outside the browser. */
  backupFileText(secret: string): string {
    const address = readVault()?.address || '';
    return [
      'CoinScope bot wallet backup',
      `Address: ${address}`,
      `Private key (base58): ${secret}`,
      `Exported: ${new Date().toISOString()}`,
      '',
      'Anyone with this key controls the wallet. Keep this file offline; never paste it into a website or chat.',
      'Restore: CoinScope > Settings > Bot wallet > Import private key, or Phantom > Add account > Import private key.',
    ].join('\n');
  },

  /** Deletes the encrypted key from this browser. Funds stay on-chain; without a backup they are unreachable. */
  async remove(password: string): Promise<void> {
    const vault = readVault();
    if (!vault) return;
    await openVault(vault, password);
    writeVault(null);
    keypair = null;
    emit();
  },

  /** Signs a swap built for this wallet and submits it through the RPC. */
  async signAndSend(serializedBase64: string, rpcUrl: string): Promise<SendResult> {
    const kp = keypair;
    if (!kp) return { success: false, message: 'Bot wallet is locked. Unlock it under Bot > Settings.' };

    let wire: Uint8Array;
    try {
      const bytes = fromB64(serializedBase64);
      let tx: VersionedTransaction | Transaction;
      try {
        tx = VersionedTransaction.deserialize(bytes);
      } catch {
        tx = Transaction.from(bytes);
      }
      // Only ever sign transactions this wallet pays for - i.e. swaps built for its own address.
      const payer = tx instanceof VersionedTransaction ? tx.message.staticAccountKeys[0] : tx.feePayer;
      if (!payer || !payer.equals(kp.publicKey)) {
        return { success: false, message: 'Refused to sign: the transaction is not paid by the bot wallet.' };
      }
      if (tx instanceof VersionedTransaction) {
        tx.sign([kp]);
        wire = tx.serialize();
      } else {
        tx.partialSign(kp);
        wire = tx.serialize();
      }
    } catch (err: any) {
      return { success: false, message: `Could not sign: ${err?.message || 'invalid transaction'}` };
    }

    try {
      const signature = await broadcast(rpcUrl, wire, false);
      return {
        success: true,
        signature,
        message: `Transaction sent: ${signature.slice(0, 8)}...`,
        rebroadcast: async () => {
          await broadcast(rpcUrl, wire, true).catch(() => {});
        },
      };
    } catch (err: any) {
      return { success: false, message: err?.message || 'RPC rejected the transaction.' };
    }
  },

  /** Sends SOL out of the bot wallet (e.g. back to Phantom). `'all'` leaves only the network fee. */
  async withdraw(to: string, amountSol: number | 'all', rpcUrl: string): Promise<SendResult & { lamports?: number }> {
    const kp = keypair;
    if (!kp) return { success: false, message: 'Unlock the bot wallet first.' };
    let dest: PublicKey;
    try {
      dest = new PublicKey(to.trim());
    } catch {
      return { success: false, message: 'That is not a valid Solana address.' };
    }
    if (dest.equals(kp.publicKey)) return { success: false, message: 'Destination is the bot wallet itself.' };

    try {
      const balance = await rpc<{ value: number }>(rpcUrl, 'getBalance', [kp.publicKey.toBase58(), { commitment: 'confirmed' }]);
      const available = Number(balance?.value || 0);
      const lamports = amountSol === 'all' ? available - BASE_FEE_LAMPORTS : Math.round(amountSol * LAMPORTS_PER_SOL);
      if (lamports <= 0 || lamports + BASE_FEE_LAMPORTS > available) {
        return { success: false, message: `Not enough SOL: wallet holds ${(available / LAMPORTS_PER_SOL).toFixed(6)} SOL.` };
      }
      const latest = await rpc<{ value: { blockhash: string } }>(rpcUrl, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const message = new TransactionMessage({
        payerKey: kp.publicKey,
        recentBlockhash: latest.value.blockhash,
        instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: dest, lamports })],
      }).compileToV0Message();
      const tx = new VersionedTransaction(message);
      tx.sign([kp]);
      const wire = tx.serialize();
      const signature = await broadcast(rpcUrl, wire, false);
      return {
        success: true,
        signature,
        lamports,
        message: `Sent ${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL to ${to.slice(0, 4)}...${to.slice(-4)}.`,
        rebroadcast: async () => {
          await broadcast(rpcUrl, wire, true).catch(() => {});
        },
      };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Withdrawal failed.' };
    }
  },
};
