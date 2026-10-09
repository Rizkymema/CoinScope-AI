---
name: memecoin-entry-pro
description: Prosedur entry memecoin gaya trader profesional (Solana/Pump.fun, PumpSwap/Raydium, dan EVM) - cek keamanan kontrak, distribusi holder, likuiditas, momentum, pemilihan setup, ukuran posisi berbasis risiko, rencana exit, lalu keputusan BUY/WAIT/SKIP dalam format baku. Pakai skill ini SETIAP KALI user menempelkan contract address (CA) atau mint, bertanya "entry gak?", "layak beli?", "cek coin ini", "snipe", "kapan masuk", "TP/SL berapa", "size berapa", atau meminta bot CoinScope membeli token - walaupun kata "skill" tidak disebut.
---

# Memecoin Entry Pro

Prosedur ini mengubah "feeling" jadi checklist. Tujuannya bukan menebak koin yang akan 100x, tapi:
1. **Menghindari rug dan jebakan** (sebagian besar kerugian datang dari sini).
2. **Masuk hanya di setup yang jelas**, dengan level invalidasi yang sudah ditentukan.
3. **Mengatur ukuran posisi** supaya satu kesalahan tidak menghapus modal.
4. **Menentukan exit sebelum entry.**

> Realitas pasar: mayoritas memecoin baru berakhir mendekati nol. Keuntungan datang dari win rate rendah-sedang dengan profit besar per menang, dan kerugian kecil per kalah. Kalau ragu, **jangan masuk** - peluang berikutnya selalu ada.

---

## 0. Aturan emas (tidak bisa ditawar)

1. **Exit ditentukan sebelum entry.** Tidak ada SL dan TP = tidak ada trade.
2. **Satu gate keamanan gagal = SKIP**, berapa pun skor dan hype-nya.
3. **Jangan pernah average down** posisi yang rugi. Tambah posisi hanya di posisi yang sudah profit dan setup-nya terkonfirmasi.
4. **Jangan kejar candle hijau parabolik** (naik > 80% dalam 5 menit). Tunggu pullback atau lewatkan.
5. **CA hanya dari sumber resmi** (pinned post X/Telegram resmi, halaman Pump.fun dari dev). Jangan dari reply, DM, atau grup - banyak token clone dengan ticker sama.
6. **Batas rugi harian tercapai = berhenti hari itu.** 3 kali rugi beruntun = rehat minimal 1 jam.
7. **Data yang tidak bisa diverifikasi dianggap risiko**, bukan dianggap aman. Tulis "BELUM TERVERIFIKASI".
8. Untuk AI/bot: **jangan pernah mengubah `paperTrading` ke `false`** tanpa instruksi eksplisit dari user di percakapan itu.

---

## 1. Alur kerja (ikuti urutannya)

```
[1] Cek kondisi akun   ->  [2] Identifikasi token  ->  [3] Gate keamanan (hard stop)
        |                                                      |
        v                                                      v
[8] Kelola & jurnal  <-  [7] Eksekusi  <-  [6] Sizing  <-  [5] Pilih setup  <-  [4] Skor 0-100
```

| Langkah | Yang dilakukan | Tool CoinScope (MCP) | Cek manual / eksternal |
| --- | --- | --- | --- |
| 1 | Mode paper/live, saldo, PnL hari ini, posisi terbuka, batas rugi harian | `get_bot_status`, `get_positions` | - |
| 2 | Pastikan CA benar dan bukan clone ticker | `search_coins`, `get_token` | X/Telegram resmi, Pump.fun |
| 3 | Gate keamanan kontrak, suplai, holder, LP | `analyze_token` (skor heuristik) | RugCheck, Solscan, Bubblemaps, GMGN/Photon; EVM: GoPlus, honeypot.is, Token Sniffer |
| 4 | Skor rubrik 100 poin (bagian 3) | `analyze_token` sebagai pembanding | Chart DexScreener / GeckoTerminal |
| 5 | Tentukan setup, zona entry, SL, invalidasi | - | Chart 1m/5m/15m |
| 6 | Hitung ukuran posisi (bagian 5) | `get_sol_price` | - |
| 7 | Beli, lalu langsung pasang TP/SL | `snipe_token`, `set_position_targets` | - |
| 8 | Tangga TP, trailing, jurnal | `get_positions`, `sell_position`, `get_trade_history` | - |

Jika dashboard CoinScope tidak online (tool bot gagal), tetap jalankan langkah 2-6 dan berikan rencana manual ke user.

**Tab Auto Trade di CoinScope** menjalankan langkah 2-6 otomatis setiap menit selama aplikasi terbuka (di HP juga): gate RugCheck (termasuk minimal 150 holder), tolak clone/parabolik, deteksi Breakout-Retest, Flag, RSI Rebound, dan Trend Pullback (mode Simple juga membeli breakout momentum, tapi tidak saat RSI 5m > 60), lalu tes jual-kembali lewat Jupiter. Daftar **Smart wallets** di tab itu menambahkan token yang dipegang wallet trader pilihan ke kandidat scan. Kartu berlabel **Ready** = setup terkonfirmasi dan skor ≥ 70; tombol Beli memakai SL/TP dari sinyal itu. Kartu **Watching** = tunggu trigger yang tertulis, jangan beli dulu. Saat **Start auto trade** aktif dan *AI review* menyala, setiap sinyal Ready dikirim ke Claude (model dipilih di Settings) yang menerapkan prosedur ini sebelum pembelian; Claude hanya boleh memperketat SL, tidak melebarkan.

---

## 2. Gate keamanan (HARD STOP - satu gagal = SKIP)

### Solana (SPL / Pump.fun)
- [ ] **Mint authority = null** (dev tidak bisa mencetak token baru).
- [ ] **Freeze authority = null** (dev tidak bisa membekukan wallet Anda sehingga tidak bisa jual).
- [ ] **Bukan Token-2022 berbahaya**: tidak ada *permanent delegate*, *transfer hook* mencurigakan, atau *transfer fee* tinggi.
- [ ] **LP terbakar/terkunci** untuk pool Raydium/PumpSwap/Meteora non-Pump.fun. (Token yang bermigrasi dari Pump.fun otomatis aman di poin ini.)
- [ ] **Dev wallet ≤ 5% suplai dan belum menjual besar.** Dev yang sudah dump = SKIP.
- [ ] **Riwayat dev bersih**: token-token sebelumnya dari wallet dev bukan rug beruntun.
- [ ] **Tidak ada bundle besar**: wallet yang membeli di slot/block yang sama saat launch dan masih memegang > ~15-20% suplai = SKIP.
- [ ] **Tidak ada cluster wallet** (Bubblemaps): banyak wallet top holder didanai dari sumber yang sama.
- [ ] **Top 10 holder ≤ 30%** (tidak termasuk bonding curve, LP, dan wallet bursa). **Satu wallet ≤ 5%.**

### EVM (Base / Ethereum / BSC / Arbitrum)
- [ ] Kontrak **verified** di explorer.
- [ ] **Bukan honeypot**: simulasi jual lolos (honeypot.is / GoPlus).
- [ ] **Pajak beli/jual ≤ 5%** dan tidak bisa diubah sepihak ke angka tinggi.
- [ ] Ownership **renounced**, atau owner tidak punya fungsi berbahaya: `mint`, `blacklist`, `setFee`/`setTax` tanpa batas, `pause`, `setMaxTx` ke 0.
- [ ] LP terkunci/terbakar dengan durasi jelas.
- [ ] Untuk token sangat baru: lakukan **test jual kecil** dulu sebelum masuk ukuran penuh.

### Tanda bahaya lain (SKIP kecuali ada alasan kuat yang tertulis)
- Volume tinggi tapi jumlah holder tidak bertambah, atau banyak transaksi dengan ukuran identik berulang (wash trading).
- Market cap besar tapi holder sedikit (contoh: mcap $200K dengan 5 holder). Scanner menolak token umur > 1 jam dengan < 150 holder.
- Satu cluster Bubblemaps memegang ≥ 40% walau audit kontrak aman, atau top 10 ≥ 75% - jangan masuk.
- Likuiditas sangat kecil dibanding market cap (likuiditas/mcap < 2%).
- Akun X baru dibuat hari ini dengan follower bot, website template salinan, Telegram dikunci.
- Ticker/nama meniru koin yang sedang trending (clone).
- Di-"call" banyak KOL sekaligus setelah harga sudah naik tinggi (sering jadi exit liquidity).

---

## 3. Rubrik skor (0-100)

Hanya dinilai jika semua gate di bagian 2 lolos.

| Kategori | Bobot | Nilai penuh jika... |
| --- | --- | --- |
| **A. Keamanan & suplai** | 30 | Semua gate lolos dengan margin (dev < 2%, top 10 < 20%, tidak ada bundle tersisa, LP burned) |
| **B. Distribusi holder** | 20 | Holder unik naik stabil, tidak didominasi sniper, banyak wallet organik dengan ukuran beragam |
| **C. Likuiditas & struktur** | 20 | Pool: likuiditas ≥ $10k dan likuiditas/mcap ≥ 10%. Curve: progres 25-70% dan naik konsisten |
| **D. Momentum & order flow** | 20 | Jumlah buy > sell (rasio ≥ 1,3) dalam 5-15 menit terakhir, volume naik saat harga naik dan turun saat pullback, struktur higher high - higher low |
| **E. Narasi & sosial** | 10 | Sesuai meta yang sedang jalan, komunitas aktif dan organik, ada alasan orang membeli besok |

**Keputusan dari skor:**

| Skor | Keputusan | Ukuran |
| --- | --- | --- |
| ≥ 80 | **BUY** | Ukuran penuh sesuai rumus (bagian 5) |
| 70-79 | **BUY kecil** atau **WAIT** konfirmasi | 50% dari ukuran rumus |
| 60-69 | **WAIT** - masuk watchlist, tunggu setup | 0 |
| < 60 | **SKIP** | 0 |

`analyze_token` CoinScope memberi skor heuristik dari likuiditas, mcap, rasio buy/sell, umur, progres curve, dan perubahan harga 5m/1h. Pakai sebagai **pembanding**, bukan pengganti rubrik ini - skor itu tidak melihat holder, dev, bundle, maupun LP.

---

## 4. Setup entry (pilih satu, tulis namanya)

Tidak ada setup yang cocok = tidak ada entry. Semua entry dilakukan di **pullback atau retest**, bukan di tengah candle hijau besar.

### Setup 1 - Curve Momentum (Pump.fun, belum graduasi)
- **Konteks:** umur 3-30 menit, progres curve 25-70% dan naik, holder unik bertambah, dev belum jual.
- **Trigger:** pullback 15-30% dari high lokal yang langsung dibeli lagi dan membentuk *higher low*, dengan jumlah buy > sell dalam 1-2 menit terakhir.
- **Entry:** setelah higher low terbentuk.
- **SL:** di bawah higher low (biasanya 20-30% dari entry).
- **Time stop:** tidak ada high baru dalam 15-20 menit = keluar.
- **Hindari:** mengejar saat curve > 85%. Area menjelang dan sesaat setelah graduasi sering jadi tempat jual early buyer.

### Setup 2 - Migration Reclaim (setelah graduasi ke PumpSwap/Raydium)
- **Konteks:** token baru bermigrasi, dump awal pasca migrasi sudah terjadi dan mulai tertahan.
- **Trigger:** candle 5m tutup kembali di atas harga migrasi / atas range dump dengan volume meningkat.
- **Entry:** saat retest level reclaim tersebut dan bertahan.
- **SL:** di bawah low dump pasca migrasi.
- **Invalidasi:** gagal bertahan di atas level reclaim dalam 2-3 candle 5m.

### Setup 3 - Breakout-Retest (token umur > 1 jam, chart sudah terbentuk)
- **Konteks:** konsolidasi/range minimal 30-60 menit di timeframe 5m.
- **Trigger:** candle 5m tutup di atas resistance range dengan volume ≥ 2× rata-rata 20 candle.
- **Entry:** di retest resistance lama yang sekarang jadi support - **bukan** di candle breakout-nya.
- **SL:** di bawah low retest, atau saat harga kembali masuk ke dalam range.
- **Time stop:** 60-120 menit tanpa lanjutan = keluar.

### Setup 4 - Trend Pullback (EMA 20 / VWAP)
- **Konteks:** tren naik jelas di 5m dan 15m (higher high - higher low), harga di atas EMA 20 dan VWAP.
- **Trigger:** pullback ke EMA 20 atau VWAP dengan volume jual mengecil, lalu muncul candle bullish yang menutup kembali di atasnya.
- **Entry:** di candle konfirmasi tersebut.
- **SL:** di bawah swing low terakhir.
- **Invalidasi:** candle 15m tutup di bawah VWAP dengan volume besar.

### Setup 5 - RSI Rebound (token umur > 1 jam)
- **Konteks:** RSI(14) di 5m turun ke **≤ 25** (oversold), tidak dalam downtrend di bawah VWAP.
- **Trigger:** candle 5m hijau yang menutup dan mengangkat RSI kembali di atas 25, **dan** volume 3 candle saat dip lebih kecil dari 6 candle sebelumnya (tekanan jual mereda).
- **Skip:** RSI sudah di bawah tapi jual masih deras - token seperti ini biasanya terus mati.
- **SL:** di bawah low 4 candle terakhir (minimal 4%, maksimal 12%).
- **Catatan:** setup ini jarang muncul dan baru teruji pada sedikit trade (lihat bagian 12).

### Konfirmasi tambahan (menaikkan keyakinan, bukan syarat tunggal)
- Holder unik naik saat harga konsolidasi (akumulasi).
- Wallet yang secara historis profit (smart money) ikut masuk - cek di GMGN/Photon. Masukkan wallet itu ke daftar **Smart wallets** di tab Auto Trade: kartu sinyal menampilkan berapa yang masih memegang, dan menambah skor sosial (+4 per wallet, maks 10).
- Wallet profit di leaderboard (24 jam / 7 hari) yang **terus membeli tanpa menjual** satu token = akumulasi, layak masuk watchlist. Holding saja bukan alasan beli: token tetap harus lolos gate dan punya setup Ready.
- Sesi ramai: volume memecoin umumnya paling tinggi di sesi US, sekitar 20.00-03.00 WIB.

---

## 5. Ukuran posisi (position sizing)

Hitung tiga batas, lalu ambil **yang terkecil**.

```
Modal trading (M)   = uang khusus trading memecoin, bukan seluruh aset
Risiko per trade    = 0,5% - 1% dari M   (maksimal 2%)

(a) Batas SL        = (Risiko per trade) / (jarak SL dalam %)
(b) Batas rug       = 3% x M     -> kerugian maksimum jika token jadi nol
                                    (rug/dump tajam bisa melompati SL)
(c) Batas likuiditas= 1% x likuiditas pool
                                    -> dampak harga rata-rata kira-kira 2%
                                       (AMM x*y=k: dampak ≈ ukuran / (likuiditas/2))

Ukuran posisi       = min(a, b, c)  x  faktor skor (1,0 untuk skor ≥ 80; 0,5 untuk 70-79)
```

**Contoh:** M = $1.000, risiko 1% = $10, SL 25%, likuiditas pool $8.000, skor 82.
- (a) $10 / 0,25 = **$40**
- (b) 3% × $1.000 = **$30**
- (c) 1% × $8.000 = **$80**
- Ukuran = min(40, 30, 80) × 1,0 = **$30**

**Batas portofolio:**
- Maksimal 3-5 posisi terbuka bersamaan; total eksposur ≤ 15% dari M.
- Batas rugi harian 3-5% dari M (isi juga di setting *daily loss limit* CoinScope).
- Hot wallet / bot wallet hanya berisi modal trading. Sisanya *withdraw*.

**Kenapa ini penting (expectancy):**
```
Expectancy = (Win rate x Rata-rata profit) - (Loss rate x Rata-rata rugi)
Rasio R:R minimum untuk impas = (1 - Win rate) / Win rate
```
Dengan win rate 30%, profit rata-rata harus ≥ 2,33× rugi rata-rata hanya untuk impas. Karena itu SL harus disiplin dan TP pertama minimal 2× jarak SL.

### 5b. Akun mikro (saldo < $100)

Rumus di atas menghasilkan posisi di bawah $1 untuk saldo kecil, padahal biaya tetap Solana tidak ikut mengecil. Untuk akun mikro, pakai aturan ini:

```
Cadangan SOL wajib   = 0,015 SOL (priority fee + rent akun token ~0,002 SOL per token baru)
Ukuran per trade     = 0,03 - 0,035 SOL  (maksimal 1/3 saldo)
Posisi bersamaan     = maksimal 2
Rugi maksimal/trade  = 5% saldo  ->  ukuran x (SL% + biaya%) ≤ 5% x saldo
Biaya pulang-pergi   ≈ 2-4% untuk posisi $3-5 (priority fee 2x + fee DEX)
```

Konsekuensinya:
- **Pilih token yang geraknya cukup besar** (target TP ≥ 30%) tapi strukturnya memungkinkan **SL ≤ 12%**. Token mapan yang naik 1-3% per jam tidak cocok, karena biaya memakan profitnya.
- **Lebih baik pool PumpSwap/Raydium yang sudah mapan** daripada bonding curve (fee curve lebih mahal dan geraknya liar).
- **Satu TP penuh** (jual 100%) lebih efisien daripada tangga TP, karena tiap penjualan parsial membayar priority fee lagi. Lindungi profit dengan profit lock (bagian 7).
- Rent akun token (~0,002 SOL) tertahan di akun token kosong setelah jual. CoinScope menutup akun kosong itu otomatis setelah jual 100% yang ditandatangani **bot wallet**, jadi rent kembali. Kalau memakai Phantom langsung, tutup akun kosong secara berkala di Phantom.
- Pagar auto-buy CoinScope: satu entry maksimal 35% dari **total modal** (bot wallet + Phantom), dan bot wallet harus punya SOL untuk beli + rent + fee. Dengan bot wallet 0,05 SOL hanya muat **1 posisi** $3,6, jadi `maxPositions` = 1 sampai bot wallet di-top-up.

---

## 6. Eksekusi

1. **Slippage:** 8-15% untuk token di bonding curve / umur < 30 menit; 2-5% untuk pool yang sudah mapan. Slippage lebih tinggi dari itu = tanda likuiditas terlalu tipis, kecilkan ukuran.
2. **Priority fee:** sedang (sekitar 0,0005-0,002 SOL). Naikkan hanya saat jaringan padat, bukan untuk "mengejar" candle.
3. **RPC pribadi** (Helius/QuickNode/Triton) supaya transaksi tidak tertunda. Di CoinScope: Settings atau env `SOLANA_RPC_URL`.
4. **Scale-in hanya untuk pemenang:** boleh masuk 50% di trigger, 50% sisanya setelah konfirmasi (higher low berikutnya). Tidak pernah menambah saat posisi minus.
5. **Langsung pasang TP/SL** setelah fill, sebelum melakukan hal lain.
6. Sebelum live pertama kali: jalankan `dry_run_live_trade` untuk memastikan jalur swap bekerja tanpa mengirim dana.

---

## 7. Rencana exit (ditulis sebelum entry)

**Tangga take-profit (default):**

| Level | Aksi |
| --- | --- |
| TP1 = +100% (2×) | Jual 50% → modal awal kembali ("take initials"). Pindahkan SL sisa posisi ke **breakeven** |
| TP2 = +200% s/d +300% | Jual 25% lagi |
| Moonbag 25% | Trailing stop 30-35% dari harga tertinggi |

Versi konservatif (pasar sepi / skor 70-79): TP1 di +50% jual 40%, sisanya ikuti tangga di atas.

**Stop-loss:**
- Berbasis struktur (di bawah higher low / low retest / swing low), biasanya 15-30%.
- Batas keras: **tidak lebih dari 35%**. Jika struktur menuntut SL lebih lebar, setup-nya tidak cocok atau ukurannya harus dikecilkan.

**Time stop:** setup 1 = 15-20 menit tanpa high baru; setup 2-4 = 60-120 menit tanpa lanjutan.

**Keluar darurat (jual semua, jangan tunggu SL):**
- Dev atau top holder mulai menjual besar.
- Likuiditas ditarik / turun tajam mendadak.
- Volume mati dan holder mulai berkurang.
- Candle 5m menutup di bawah level invalidasi dengan volume besar.

**Profit lock (trade yang sudah untung tidak boleh ditutup rugi):**
- Begitu posisi pernah naik **+X%** dari modal (`profitLockTriggerPercent`), SL otomatis naik ke **modal + Y%** (`profitLockPercent`). Y menutup fee dan slippage saat jual, sehingga hasil akhirnya tetap hijau.
- Default CoinScope: trigger **+30%**, kunci **+8%**. Untuk akun mikro dengan TP sekitar +35%: trigger **+20%**, kunci **+8%**.
- Keterbatasan: kalau harga jatuh lebih dari Y% di antara dua update harga (rug, dump satu blok), penjualan bisa terisi di bawah modal. Profit lock memperkecil risiko itu, tapi tidak bisa meniadakannya 100%.
- Bot berjalan di tab browser. Tab tertutup = SL, TP, dan profit lock tidak jalan.

**Di CoinScope:** satu posisi hanya punya satu TP dan satu SL. Jalankan tangganya begini:
1. Setelah fill: `set_position_targets` → `takeProfitPercent: 100`, `stopLossPercent: <SL setup>`.
2. Saat TP1 tercapai: `sell_position` dengan `percent: 50`, lalu `set_position_targets` untuk sisa (TP ke level TP2). Profit lock sudah menaikkan SL di atas modal.
3. Trailing stop moonbag diatur global lewat `update_settings` → `trailingStopPercent`.

---

## 8. Preset setting bot CoinScope ("Pro - Konservatif")

Pakai lewat `update_settings`. Sesuaikan `buyAmountUsd` dengan hasil rumus bagian 5.

```json
{
  "buyAmountUsd": 30,
  "stopLossPercent": 25,
  "takeProfitPercent": 100,
  "trailingStopPercent": 30,
  "profitLockTriggerPercent": 30,
  "profitLockPercent": 8,
  "minLiquidityUsd": 5000,
  "maxTokenAgeMinutes": 60,
  "maxPositions": 3,
  "slippagePercent": 10,
  "minBondingCurvePercent": 25,
  "aiGateEnabled": true,
  "aiMinConfidence": 70,
  "priorityFeeSol": 0.001,
  "paperTrading": true
}
```

Jalankan preset ini di **paper** minimal 30-50 trade. Pindah ke live hanya jika expectancy di History positif, dan hanya atas instruksi eksplisit user.

---

## 9. Format output keputusan (wajib dipakai)

Setiap analisis entry diakhiri dengan blok ini, lengkap. Item yang tidak bisa dicek ditulis **BELUM TERVERIFIKASI**.

```
TOKEN      : <SYMBOL> (<chain>)
CA         : <alamat lengkap>
SUMBER CA  : <link resmi tempat CA diverifikasi>
DATA       : harga $..., mcap $..., likuiditas $..., umur ... menit, curve ...%, buy/sell 24j .../...

GATE KEAMANAN
  Mint authority   : null / ADA / BELUM TERVERIFIKASI
  Freeze authority : null / ADA / BELUM TERVERIFIKASI
  LP               : burned/locked/curve / TIDAK / BELUM TERVERIFIKASI
  Dev holding      : ...%  (jual? ya/tidak)
  Top 10 holder    : ...%   Bundle/sniper tersisa: ...%
  Hasil            : LOLOS / GAGAL (<alasan>)

SKOR       : A ../30  B ../20  C ../20  D ../20  E ../10  = ../100
             (analyze_token CoinScope: ../100 sebagai pembanding)

SETUP      : <1 Curve Momentum | 2 Migration Reclaim | 3 Breakout-Retest | 4 Trend Pullback | 5 RSI Rebound | tidak ada>
ENTRY ZONE : $... - $...
SL         : $... (-..%)      INVALIDASI: <kondisi>
TP         : TP1 $... (+100%, jual 50%) | TP2 $... (+..%, jual 25%) | moonbag trailing ..%
TIME STOP  : ... menit

SIZING     : (a) $..  (b) $..  (c) $..  x faktor ..  = $.. (.. SOL)
R:R        : 1 : ..

KEPUTUSAN  : BUY / BUY KECIL / WAIT / SKIP
KEYAKINAN  : ..%
ALASAN     : <2-3 kalimat, sebut risiko terbesar>
```

Jika keputusan **BUY** dan user setuju (atau mode auto sudah diizinkan user):
```
snipe_token        { token: "<CA>", amountUsd: <ukuran>, reason: "<setup + skor>" }
set_position_targets { position: "<id/symbol>", takeProfitPercent: 100, stopLossPercent: <SL> }
```

---

## 10. Jurnal & evaluasi

Catat setiap trade (menang maupun kalah). Tanpa jurnal, tidak ada perbaikan.

| Tanggal | Token | Setup | Skor | Entry | SL | Exit | PnL % | Ikut aturan? | Catatan / pelajaran |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | ya/tidak | |

Evaluasi mingguan (pakai `get_trade_history`):
- Win rate dan R:R rata-rata per **setup** - buang setup yang expectancy-nya negatif setelah ≥ 20 trade.
- Berapa trade yang **melanggar aturan**, dan berapa total kerugian dari pelanggaran itu.
- Jam/sesi dengan hasil terbaik dan terburuk.

---

## 10b. Teknik dari video YouTube yang sudah diuji (9 Okt 2026)

Sumber: MemeCoin id (Axiom Pro: RSI, audit, bubble maps, gas fee) dan Duta Crypto (leaderboard, ambil modal). Backtest pada candle 5m nyata dari 9-12 token aman selama ~3,5 hari, memakai fungsi `readChart` scanner yang asli, fee pulang-pergi 3%, TP 15%, profit lock +8% → +4%. Sampel kecil: anggap sebagai arah, bukan bukti.

| Teknik | Hasil | Dipakai? |
| --- | --- | --- |
| "Jangan FOMO, tunggu RSI di bawah" sebagai filter momentum (lewati jika RSI 5m > 60) | Momentum dari -1,41% → -0,18% per trade, konsisten di dua paruh data | **Ya** (`MOMENTUM_MAX_RSI`) |
| Beli pantulan RSI oversold + tekanan jual mereda | RSI ≤ 25: 1-5 trade, semua positif; RSI ≤ 30: impas | **Ya**, setup RSI Rebound |
| Jual saat RSI menyentuh 50 ("cuan tipis") | -1,8% per trade di 5m: profit kecil habis fee | Tidak |
| Jual saat pantulan RSI gagal menembus garis tengah | Win rate 13%, -3,5% per trade | **Tidak - merugikan** |
| Jual saat RSI ≥ 80 | Sedikit lebih buruk dari TP biasa | Tidak |
| Filter RSI ≤ 60 untuk semua setup | Tidak membaik | Tidak |
| Holder sedikit untuk mcap besar = skip | Gate keamanan, tidak di-backtest | **Ya** (< 150 holder) |
| Ikuti wallet pro / akumulasi leaderboard | Tidak bisa di-backtest dengan data gratis | **Ya**, daftar Smart wallets (konfirmasi + penemuan) |
| Priority fee 0,005 SOL, slippage 20-30% | Untuk $3,6 itu ±30% biaya pulang-pergi; slippage 30% mengundang sandwich | **Tidak** - pakai bagian 6 |
| Ambil modal saat 2× lalu biarkan sisa (moonbag) | Benar untuk posisi besar; di $3,6 penjualan parsial membayar fee lagi | Hanya untuk posisi ≥ $20 |

Temuan lain dari backtest yang sama:
- Setup **Trend Pullback** paling buruk di sampel ini (33% menang, -4,6% per trade) dan Breakout-Retest -2,3%. Pantau hasil per setup di History sebelum menambah ukuran.
- **Profit lock +8% → +4%** mengubah banyak trade jadi hanya +1% bersih setelah fee, sementara rugi rata-rata -11%. TP 20% dengan lock +12% → +6%, atau TP 25% dengan lock +15% → +8%, memperbaiki hasil momentum (+0,7% s/d +1,4% per trade). Mengubahnya adalah keputusan user.
- Klaim "cuan 1 juta/hari" di video berasal dari modal > Rp200 ribu per entry dan tautan referral; tidak ada bukti win rate yang bisa diverifikasi.

---

## 11. Checklist psikologi sebelum klik beli

- [ ] Saya masuk karena **setup**, bukan karena takut ketinggalan (FOMO).
- [ ] Saya **tidak** sedang membalas kerugian sebelumnya (revenge trade).
- [ ] SL, TP, dan ukuran sudah tertulis.
- [ ] Jika token ini jadi nol detik ini juga, kerugiannya ≤ 3% modal dan saya tetap tenang.
- [ ] Belum menyentuh batas rugi harian.

Satu kotak tidak tercentang = jangan klik.

---

*Bukan nasihat keuangan. Memecoin adalah aset berisiko sangat tinggi; gunakan hanya dana yang siap hilang seluruhnya.*
