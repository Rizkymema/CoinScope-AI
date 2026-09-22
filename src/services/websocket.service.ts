import { CoinData } from '../types/coin';
import { TokenTradeEvent } from '../types/bot';
import { PumpFunService, PumpPortalNewToken } from './pumpfun.service';
import { SolPriceService } from './solprice.service';

/**
 * PumpPortal real-time data stream (free, no API key).
 *  - subscribeNewToken      -> every token created on Pump.fun / Bonk / LaunchLab
 *  - subscribeTokenTrade    -> every buy/sell for the mints we hold or watch (price ticks)
 *  - subscribeMigration     -> bonding-curve graduations
 * Docs: https://pumpportal.fun/data-api/real-time
 */
const PUMPPORTAL_WS_URL = 'wss://pumpportal.fun/api/data';
const PUMPPORTAL_HTTP_URL = 'https://pumpportal.fun/';
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const LATENCY_PROBE_MS = 10_000;

type TokenCallback = (coin: CoinData) => void;
type TradeCallback = (trade: TokenTradeEvent) => void;
type MigrationCallback = (evt: { mint: string; pool?: string; signature?: string }) => void;
type ConnectionCallback = (status: { connected: boolean; latencyMs: number; eventsPerMinute: number }) => void;

export class PumpPortalWebSocket {
  private ws: WebSocket | null = null;
  private tokenListeners = new Set<TokenCallback>();
  private tradeListeners = new Set<TradeCallback>();
  private migrationListeners = new Set<MigrationCallback>();
  private connListeners = new Set<ConnectionCallback>();
  private latencyTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private manuallyClosed = false;
  private isConnected = false;
  private latencyMs = 0;
  private eventTimestamps: number[] = [];
  private tradeSubscriptions = new Set<string>();
  private wantNewTokens = false;
  private wantMigrations = false;

  get connected() {
    return this.isConnected;
  }

  connect() {
    if (typeof window === 'undefined') return;
    this.manuallyClosed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Warm the SOL price cache so incoming events can be priced in USD immediately.
    SolPriceService.getSolPriceUsd().catch(() => {});

    try {
      this.ws = new WebSocket(PUMPPORTAL_WS_URL);
    } catch {
      this.isConnected = false;
      this.notifyConn();
      this.scheduleReconnect();
      return;
    }

    const socket = this.ws;

    socket.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.notifyConn();
      this.resubscribe();
      this.startLatencyProbe();
    };

    socket.onmessage = (event) => {
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!data || typeof data !== 'object') return;
      if (data.message || data.errors) return; // subscription acks / errors

      this.recordEvent();

      const txType = String(data.txType || '').toLowerCase();

      if (txType === 'create') {
        const coin = PumpFunService.mapPumpPortalNewToken(data as PumpPortalNewToken, SolPriceService.getCached());
        if (coin) this.tokenListeners.forEach((cb) => cb(coin));
        return;
      }

      if (txType === 'migrate' || txType === 'migration') {
        this.migrationListeners.forEach((cb) => cb({ mint: data.mint, pool: data.pool, signature: data.signature }));
        return;
      }

      if ((txType === 'buy' || txType === 'sell') && data.mint) {
        const vSol = Number(data.vSolInBondingCurve) || 0;
        const vTokens = Number(data.vTokensInBondingCurve) || 0;
        const marketCapSol = Number(data.marketCapSol) || 0;
        const priceSol =
          vSol > 0 && vTokens > 0 ? vSol / vTokens : marketCapSol > 0 ? marketCapSol / 1_000_000_000 : 0;

        const trade: TokenTradeEvent = {
          mint: data.mint,
          txType,
          solAmount: Number(data.solAmount) || 0,
          tokenAmount: Number(data.tokenAmount) || 0,
          priceSol,
          marketCapSol,
          vSolInBondingCurve: vSol || undefined,
          vTokensInBondingCurve: vTokens || undefined,
          pool: data.pool,
          traderPublicKey: data.traderPublicKey,
          signature: data.signature,
          timestamp: Date.now(),
        };
        this.tradeListeners.forEach((cb) => cb(trade));
      }
    };

    socket.onerror = () => {
      this.isConnected = false;
      this.notifyConn();
    };

    socket.onclose = () => {
      this.isConnected = false;
      this.notifyConn();
      this.stopLatencyProbe();
      if (!this.manuallyClosed) this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manuallyClosed = true;
    this.stopLatencyProbe();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.isConnected = false;
    this.notifyConn();
  }

  /** Subscribe to the global new-token stream. */
  subscribeNewTokens() {
    this.wantNewTokens = true;
    this.send({ method: 'subscribeNewToken' });
  }

  unsubscribeNewTokens() {
    this.wantNewTokens = false;
    this.send({ method: 'unsubscribeNewToken' });
  }

  subscribeMigrations() {
    this.wantMigrations = true;
    this.send({ method: 'subscribeMigration' });
  }

  /** Track trades (price ticks) for specific mints. */
  subscribeTokenTrades(mints: string[]) {
    const fresh = mints.filter((m) => m && !this.tradeSubscriptions.has(m));
    if (fresh.length === 0) return;
    fresh.forEach((m) => this.tradeSubscriptions.add(m));
    this.send({ method: 'subscribeTokenTrade', keys: fresh });
  }

  unsubscribeTokenTrades(mints: string[]) {
    const tracked = mints.filter((m) => this.tradeSubscriptions.has(m));
    if (tracked.length === 0) return;
    tracked.forEach((m) => this.tradeSubscriptions.delete(m));
    this.send({ method: 'unsubscribeTokenTrade', keys: tracked });
  }

  getTrackedMints(): string[] {
    return Array.from(this.tradeSubscriptions);
  }

  onNewToken(cb: TokenCallback) {
    this.tokenListeners.add(cb);
    return () => {
      this.tokenListeners.delete(cb);
    };
  }

  onTokenTrade(cb: TradeCallback) {
    this.tradeListeners.add(cb);
    return () => {
      this.tradeListeners.delete(cb);
    };
  }

  onMigration(cb: MigrationCallback) {
    this.migrationListeners.add(cb);
    return () => {
      this.migrationListeners.delete(cb);
    };
  }

  onConnectionChange(cb: ConnectionCallback) {
    this.connListeners.add(cb);
    cb(this.status());
    return () => {
      this.connListeners.delete(cb);
    };
  }

  private status() {
    return { connected: this.isConnected, latencyMs: this.latencyMs, eventsPerMinute: this.eventsPerMinute() };
  }

  private send(payload: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch {
        // socket closed mid-send; the subscription state is kept and replayed on reconnect
      }
    }
  }

  private resubscribe() {
    if (this.wantNewTokens) this.send({ method: 'subscribeNewToken' });
    if (this.wantMigrations) this.send({ method: 'subscribeMigration' });
    if (this.tradeSubscriptions.size > 0) {
      this.send({ method: 'subscribeTokenTrade', keys: Array.from(this.tradeSubscriptions) });
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.manuallyClosed) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private recordEvent() {
    const now = Date.now();
    this.eventTimestamps.push(now);
    if (this.eventTimestamps.length > 500) this.eventTimestamps.splice(0, this.eventTimestamps.length - 500);
  }

  private eventsPerMinute(): number {
    const cutoff = Date.now() - 60_000;
    this.eventTimestamps = this.eventTimestamps.filter((t) => t >= cutoff);
    return this.eventTimestamps.length;
  }

  /** Measures a real HTTP round trip to the PumpPortal host (the socket protocol has no ping reply). */
  private async probeLatency() {
    const started = performance.now();
    try {
      await fetch(PUMPPORTAL_HTTP_URL, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
      this.latencyMs = Math.round(performance.now() - started);
    } catch {
      // keep the previous reading
    }
    this.notifyConn();
  }

  private startLatencyProbe() {
    this.stopLatencyProbe();
    this.probeLatency();
    this.latencyTimer = setInterval(() => this.probeLatency(), LATENCY_PROBE_MS);
  }

  private stopLatencyProbe() {
    if (this.latencyTimer) {
      clearInterval(this.latencyTimer);
      this.latencyTimer = null;
    }
  }

  private notifyConn() {
    const s = this.status();
    this.connListeners.forEach((cb) => cb(s));
  }
}

export const wsService = new PumpPortalWebSocket();
