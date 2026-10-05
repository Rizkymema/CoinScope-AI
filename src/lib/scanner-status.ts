/**
 * Latest setup-scanner result in compact form. The scanner store writes it after every scan and
 * the MCP bridge sends it with the dashboard snapshot, so a remote supervisor can see what the
 * in-app scanner sees without running its own scans (which would spend the same GeckoTerminal
 * rate limit). Kept in its own module so the bridge does not import the scanner store.
 */
export interface ScannerSignalBrief {
  symbol: string;
  mint: string;
  setup?: string;
  score?: number;
  reason: string;
  entryLow?: number;
  entryHigh?: number;
  stopPrice?: number;
  targetPrice?: number;
  slPercent?: number;
  tpPercent?: number;
  netRewardRisk?: number;
}

export interface ScannerSummary {
  enabled: boolean;
  scannedAt: number | null;
  candidates: number;
  ready: ScannerSignalBrief[];
  watch: ScannerSignalBrief[];
  /** How many rejections each reason caused this scan, most common first. */
  rejectedBy: { reason: string; count: number }[];
  error: string | null;
}

let latest: ScannerSummary | null = null;

export const setScannerSummary = (summary: ScannerSummary) => {
  latest = summary;
};

export const getScannerSummary = (): ScannerSummary | null => latest;
