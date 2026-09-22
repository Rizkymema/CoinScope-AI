'use client';

import React, { useState, useRef, useEffect } from 'react';
import { AIService, ChatMessageParam, ChatToolUseBlock, ChatToolResultParam } from '@/services/ai.service';
import { executeBotTool } from '@/lib/bot-tool-executor';
import { useCoinStore } from '@/store/useCoinStore';
import { useBotStore } from '@/store/useBotStore';
import { Send, Bot, User, Loader2, X, MessageSquare, Wrench, AlertTriangle } from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
}

const MAX_TOOL_ROUNDS = 8;

const QUICK_PROMPTS = [
  'Tampilkan 5 coin terbaru yang paling menarik',
  'Bagaimana status bot dan posisi saya?',
  'Nyalakan bot dengan TP 80% dan SL 25%',
  'Jual semua posisi yang sedang rugi',
];

export const AIJudgeChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState<string | null>(null);
  const historyRef = useRef<ChatMessageParam[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { selectedCoin, aiAnalysis } = useCoinStore();
  const isBotActive = useBotStore((s) => s.isActive);
  const positionsCount = useBotStore((s) => s.positions.length);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  useEffect(() => {
    if (selectedCoin && isOpen && !input) {
      setInput(`Analisa ${selectedCoin.name} (${selectedCoin.symbol}) - layak dibeli?`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCoin, isOpen]);

  const pushMessage = (msg: ChatMessage) => setMessages((prev) => [...prev, msg]);
  const patchMessage = (id: string, patch: Partial<ChatMessage>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const runConversation = async (userText: string) => {
    const selected = useCoinStore.getState().selectedCoin;
    const contextNote = selected
      ? `\n\n[Context: user currently has ${selected.symbol} (${selected.id}) selected in the dashboard]`
      : '';
    historyRef.current.push({ role: 'user', content: userText + contextNote });

    const assistantId = `a-${Date.now()}`;
    pushMessage({ id: assistantId, role: 'assistant', content: '', isStreaming: true });
    await continueLoop(assistantId, 0, userText);
  };

  /** Continues the tool loop after the first round, writing into `bubbleId`. */
  const continueLoop = async (bubbleId: string, startRound: number, userText: string): Promise<string> => {
    let rounds = startRound;
    let currentBubble = bubbleId;
    while (rounds < MAX_TOOL_ROUNDS) {
      rounds += 1;
      const snapshot = useBotStore.getState().getSnapshot();
      const turn = await AIService.chatTurn(historyRef.current, snapshot);
      if (turn.error) {
        const noKey = /ANTHROPIC_API_KEY/i.test(turn.error);
        if (noKey) setAiUnavailable(turn.error);
        // Drop the un-answered user turn so the history stays valid for the next attempt.
        const last = historyRef.current[historyRef.current.length - 1];
        if (last?.role === 'user') historyRef.current.pop();
        const text = noKey ? AIService.localReply(userText, useCoinStore.getState().selectedCoin, aiAnalysis) : `⚠️ ${turn.error}`;
        patchMessage(currentBubble, { content: text, isStreaming: false, isError: !noKey });
        return text;
      }
      historyRef.current.push({ role: 'assistant', content: turn.content });
      const textParts = turn.content.filter((b) => b.type === 'text').map((b: any) => b.text as string);
      const toolUses = turn.content.filter((b): b is ChatToolUseBlock => b.type === 'tool_use');

      if (toolUses.length === 0 || turn.stop_reason === 'refusal') {
        const text = textParts.join('\n') || '(selesai)';
        patchMessage(currentBubble, { content: text, isStreaming: false });
        return text;
      }

      if (textParts.length) patchMessage(currentBubble, { content: textParts.join('\n') });
      const results: ChatToolResultParam[] = [];
      for (const tu of toolUses) {
        const toolMsgId = `t-${tu.id}`;
        pushMessage({ id: toolMsgId, role: 'tool', content: `${tu.name}(${JSON.stringify(tu.input)})` });
        const { result, isError } = await executeBotTool(tu.name, tu.input);
        patchMessage(toolMsgId, {
          content: `${tu.name} → ${isError ? 'ERROR ' : ''}${result.length > 160 ? result.slice(0, 160) + '…' : result}`,
          isError,
        });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: result, is_error: isError || undefined });
      }
      historyRef.current.push({ role: 'user', content: results });
      patchMessage(currentBubble, { isStreaming: false });
      currentBubble = `a-${Date.now()}-${rounds}`;
      pushMessage({ id: currentBubble, role: 'assistant', content: '', isStreaming: true });
    }
    patchMessage(currentBubble, { content: 'Batas putaran tool tercapai. Coba perintah yang lebih spesifik.', isStreaming: false });
    return '';
  };

  const submit = async (text: string) => {
    const clean = text.trim();
    if (!clean || isProcessing) return;
    pushMessage({ id: `u-${Date.now()}`, role: 'user', content: clean });
    setInput('');
    setIsProcessing(true);
    try {
      await runConversation(clean);
    } catch (err: any) {
      pushMessage({ id: `e-${Date.now()}`, role: 'assistant', content: `⚠️ ${err?.message || 'AI request failed'}`, isError: true });
    } finally {
      setIsProcessing(false);
      setMessages((prev) => prev.map((m) => ({ ...m, isStreaming: false })));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 z-50 p-4 rounded-2xl shadow-2xl transition-all duration-300 ${
          isOpen ? 'bg-ink-800 text-slate-400 hover:text-white scale-90 opacity-0 pointer-events-none' : 'bg-signal text-ink-950 hover:bg-signal-soft hover:scale-105'
        }`}
        aria-label="Open AI trading assistant"
      >
        <MessageSquare className="w-6 h-6" />
        <span className="absolute top-0 right-0 flex h-3 w-3 -mt-1 -mr-1">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isBotActive ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
          <span className={`relative inline-flex rounded-full h-3 w-3 ${isBotActive ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
        </span>
      </button>

      <div
        className={`fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-2rem)] flex flex-col h-[640px] max-h-[calc(100vh-6rem)] surface rounded-2xl overflow-hidden shadow-2xl shadow-black/40 transition-all duration-300 origin-bottom-right ${
          isOpen ? 'scale-100 opacity-100' : 'scale-50 opacity-0 pointer-events-none'
        }`}
      >
        <div className="p-4 border-b border-white/8 bg-ink-850/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-signal/15 p-2 rounded-xl">
              <Bot className="w-5 h-5 text-signal-soft" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-sm">AI Trading Copilot</h2>
              <p className="text-xs text-slate-400 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full inline-block ${aiUnavailable ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                {aiUnavailable ? 'AI key belum diset' : `Bot ${isBotActive ? 'running' : 'paused'} · ${positionsCount} posisi`}
              </p>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-slate-700 rounded-xl transition-colors text-slate-400 hover:text-white" aria-label="Close chat">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 p-4 overflow-y-auto space-y-3 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
              <div className="bg-signal/10 p-4 rounded-2xl">
                <Bot className="w-8 h-8 text-signal/50" />
              </div>
              <div className="text-center px-2">
                <p className="text-sm text-slate-300 font-medium mb-1">Kontrol bot lewat chat</p>
                <p className="text-xs text-slate-500">
                  Saya bisa membaca coin terbaru, menilai risiko, membeli/menjual, mengubah strategi dan menyalakan bot.
                </p>
              </div>
              <div className="flex flex-col gap-1.5 w-full px-2">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    onClick={() => submit(q)}
                    className="text-left text-xs px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 text-slate-300 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) =>
              msg.role === 'tool' ? (
                <div key={msg.id} className={`mx-auto max-w-[95%] text-[10px] font-mono px-3 py-1.5 rounded-lg border flex items-start gap-2 ${msg.isError ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-ink-950/60 border-white/8 text-slate-400'}`}>
                  {msg.isError ? <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> : <Wrench className="w-3 h-3 mt-0.5 shrink-0 text-amber-400" />}
                  <span className="break-all">{msg.content}</span>
                </div>
              ) : (
                <div key={msg.id} className={`flex gap-3 max-w-[88%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-signal text-ink-950' : 'bg-ink-850 border border-white/10'}`}>
                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-signal-soft" />}
                  </div>
                  <div
                    className={`p-3 rounded-2xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-signal text-ink-950 rounded-tr-sm'
                        : msg.isError
                        ? 'bg-rose-500/10 text-rose-200 border border-rose-500/30 rounded-tl-sm'
                        : 'bg-ink-850 text-slate-200 border border-white/8 rounded-tl-sm'
                    }`}
                  >
                    <p className="leading-relaxed whitespace-pre-wrap break-words">
                      {msg.content || (msg.isStreaming ? 'Memproses…' : '')}
                      {msg.isStreaming && <span className="animate-pulse ml-1">▋</span>}
                    </p>
                  </div>
                </div>
              )
            )
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 bg-ink-900 border-t border-white/8">
          <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isProcessing}
              placeholder="Perintah: beli X $20, jual Y, set TP 100%…"
              className="flex-1 bg-ink-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/30 transition-colors disabled:opacity-50"
              aria-label="Ask the AI copilot"
            />
            <button
              type="submit"
              disabled={!input.trim() || isProcessing}
              className="p-3 bg-signal text-ink-950 rounded-xl hover:bg-signal-soft disabled:opacity-50 disabled:hover:bg-signal transition-colors shrink-0"
            >
              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </div>
    </>
  );
};
