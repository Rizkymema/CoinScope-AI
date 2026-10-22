import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { GATE_MAX_TOKENS, aiErrorNote, extractText, getAnthropic, hasAnthropicCredentials, isPermanentAiError, modelFor, parseJsonObject } from '@/lib/ai-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const TIMEOUT_MS = 40_000;

/**
 * Stage 4 of the convergence flow: the AI is the last checker and looks for reasons to reject.
 * The system prompt is the one from the flow document, word for word. It does not size the
 * position and cannot overrule the hard gate: it only sees tokens that already passed it, and the
 * dashboard trades only `verdict = ENTRY` with enough confidence.
 */
const SYSTEM_PROMPT = `Kamu adalah analis risiko meme coin. Tugasmu memeriksa satu token yang sudah lolos filter otomatis dan memutuskan ENTRY, WATCH, atau SKIP.

Aturan:
1. Cari alasan untuk menolak terlebih dulu. Default-mu adalah SKIP kalau ragu.
2. Gunakan hanya data di input. Jangan mengarang data yang tidak ada; tulis "data tidak tersedia".
3. Red flag kritis = otomatis SKIP: wallet pemicu dari cluster yang sama, dev atau wallet terkait mulai menjual, likuiditas turun, holder unik stagnan saat volume naik, atau wallet pemicu sudah menjual sebagian.
4. ENTRY hanya jika skor momentum >= 60, tidak ada red flag kritis, dan minimal 2 alasan kuat.
5. WATCH jika datanya menarik tapi belum cukup; sebutkan apa yang harus terjadi agar naik ke ENTRY.
6. Jangan menyarankan ukuran posisi, target harga, atau leverage.
7. Balas HANYA dengan JSON sesuai skema, tanpa teks lain.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'confidence', 'red_flags', 'alasan', 'syarat_naik_ke_entry', 'data_kurang'],
  properties: {
    verdict: { type: 'string', enum: ['ENTRY', 'WATCH', 'SKIP'] },
    confidence: { type: 'integer', description: '0-100' },
    red_flags: { type: 'array', items: { type: 'string' } },
    alasan: { type: 'array', items: { type: 'string' }, description: 'maksimal 3 poin singkat' },
    syarat_naik_ke_entry: { type: 'string', description: 'diisi jika WATCH' },
    data_kurang: { type: 'array', items: { type: 'string' } },
  },
} as const;

interface Verdict {
  verdict?: string;
  confidence?: number;
  red_flags?: unknown;
  alasan?: unknown;
  syarat_naik_ke_entry?: unknown;
  data_kurang?: unknown;
}

const strings = (v: unknown, max = 10) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, max) : []);

/** Unreadable or out-of-schema output is a SKIP, never an entry. */
function normalize(p: Verdict | null) {
  const verdict = p?.verdict === 'ENTRY' || p?.verdict === 'WATCH' || p?.verdict === 'SKIP' ? p.verdict : null;
  if (!p || !verdict) return null;
  return {
    verdict,
    confidence: Math.max(0, Math.min(100, Math.round(Number(p.confidence) || 0))),
    red_flags: strings(p.red_flags),
    alasan: strings(p.alasan, 3),
    syarat_naik_ke_entry: String(p.syarat_naik_ke_entry ?? ''),
    data_kurang: strings(p.data_kurang),
  };
}

const skip = (note: string) => ({ verdict: 'SKIP', confidence: 0, red_flags: [], alasan: [note], syarat_naik_ke_entry: '', data_kurang: [] });

/** GET -> whether the server has a Claude key. */
export async function GET() {
  return NextResponse.json({ configured: hasAnthropicCredentials() });
}

/** POST { package, model? } -> { available, verdict, model?, note? } */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 'ai-convergence', 60, 60_000);
  if (limited) return limited;
  let pkg: unknown;
  let model: string;
  try {
    const body = await req.json();
    pkg = body?.package;
    model = modelFor(body?.model);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!pkg || typeof pkg !== 'object') return NextResponse.json({ error: 'package is required' }, { status: 400 });

  if (!hasAnthropicCredentials()) {
    return NextResponse.json({ available: false, configured: false, note: 'No ANTHROPIC_API_KEY on the server', verdict: skip('AI tidak dikonfigurasi') });
  }

  try {
    const response = await getAnthropic().messages.create(
      {
        model,
        max_tokens: GATE_MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content: `Data token (tahap 1-3, semua angka diukur oleh sistem; field yang tidak ada berarti data tidak tersedia):\n${JSON.stringify(pkg, null, 2)}`,
          },
        ],
      },
      { timeout: TIMEOUT_MS, maxRetries: 0 }
    );
    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ available: true, model: response.model, verdict: skip('AI menolak menilai token ini') });
    }
    const parsed = response.stop_reason === 'max_tokens' ? null : normalize(parseJsonObject<Verdict>(extractText(response)));
    // The document's rule: a response that cannot be parsed as JSON counts as SKIP.
    if (!parsed) return NextResponse.json({ available: true, model: response.model, note: 'Unparseable AI output - counted as SKIP', verdict: skip('Respons AI tidak bisa di-parse') });
    return NextResponse.json({ available: true, model: response.model, verdict: parsed });
  } catch (error) {
    return NextResponse.json({ available: false, permanent: isPermanentAiError(error), note: aiErrorNote(error), verdict: skip(aiErrorNote(error)) });
  }
}
