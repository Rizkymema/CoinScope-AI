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
  'Show the 5 most promising new launches',
  'What is the bot status and my open positions?',
  'Start the bot with TP 80% and SL 25%',
  'Sell every position that is currently down',
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
      setInput(`Is ${selectedCoin.name} (${selectedCoin.symbol}) worth buying right now?`);
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
        const text = noKey ? AIService.localReply(userText, useCoinStore.getState().selectedCoin, aiAnalysis) : turn.error;
        patchMessage(currentBubble, { content: text, isStreaming: false, isError: !noKey });
        return text;
      }
      historyRef.current.push({ role: 'assistant', content: turn.content });
      const textParts = turn.content.filter((b) => b.type === 'text').map((b: any) => b.text as string);
      const toolUses = turn.content.filter((b): b is ChatToolUseBlock => b.type === 'tool_use');

      if (toolUses.length === 0 || turn.stop_reason === 'refusal') {
        const text = textParts.join('\n') || 'Done.';
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
          content: `${tu.name} -> ${isError ? 'ERROR ' : ''}${result.length > 160 ? result.slice(0, 160) + '…' : result}`,
          isError,
        });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: result, is_error: isError || undefined });
      }
      historyRef.current.push({ role: 'user', content: results });
      patchMessage(currentBubble, { isStreaming: false });
      currentBubble = `a-${Date.now()}-${rounds}`;
      pushMessage({ id: currentBubble, role: 'assistant', content: '', isStreaming: true });
    }
    patchMessage(currentBubble, { content: 'Tool limit reached. Try a more specific instruction.', isStreaming: false });
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
      pushMessage({ id: `e-${Date.now()}`, role: 'assistant', content: err?.message || 'AI request failed', isError: true });
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
        className={`fixed bottom-6 right-6 z-50 p-4 rounded-xl  transition-all duration-300 ${
          isOpen ? 'bg-ink-800 text-slate-400 hover:text-white scale-90 opacity-0 pointer-events-none' : 'bg-signal text-ink-950 hover:bg-signal-soft hover:scale-105'
        }`}
        aria-label="Open AI trading assistant"
      >
        <MessageSquare className="w-6 h-6" />
        <span className="absolute top-0 right-0 flex h-3 w-3 -mt-1 -mr-1">
          <span className={` absolute inline-flex h-full w-full rounded-full opacity-75 ${isBotActive ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
          <span className={`relative inline-flex rounded-full h-3 w-3 ${isBotActive ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
        </span>
      </button>

      <div
        className={`fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-2rem)] flex flex-col h-[640px] max-h-[calc(100vh-6rem)] surface rounded-xl overflow-hidden   transition-all duration-300 origin-bottom-right ${
          isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0 pointer-events-none'
        }`}
      >
        <div className="px-4 py-3 border-b border-line flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-signal/12 border border-signal/25">
              <Bot className="w-4 h-4 text-signal" />
            </span>
            <div>
              <h2 className="font-bold text-white text-[13px]">Trading copilot</h2>
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                <span className={`dot ${aiUnavailable ? 'dot-warn' : isBotActive ? 'dot-live' : 'dot-idle'}`} />
                {aiUnavailable ? 'Server API key not set' : `Bot ${isBotActive ? 'running' : 'paused'} · ${positionsCount} open`}
              </p>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors" aria-label="Close chat">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 p-3.5 overflow-y-auto space-y-2.5">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
              <div className="grid place-items-center w-12 h-12 rounded-xl bg-ink-850 border border-line">
                <Bot className="w-5 h-5 text-slate-500" />
              </div>
              <div className="text-center px-2">
                <p className="text-[13px] text-white font-semibold">Ask or instruct</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Reads the launch feed, scores risk, buys and sells, edits strategy, and starts or pauses the bot.
                </p>
              </div>
              <div className="flex flex-col gap-1.5 w-full px-2">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    onClick={() => submit(q)}
                    className="text-left text-xs px-3 py-2 rounded-lg panel-interactive text-slate-300"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) =>
              msg.role === 'tool' ? (
                <div key={msg.id} className={`mx-auto max-w-[95%] text-[10px] font-mono px-3 py-1.5 rounded-lg border flex items-start gap-2 ${msg.isError ? 'bg-neg/10 border-neg/25 text-neg' : 'bg-ink-850 border-line text-slate-400'}`}>
                  {msg.isError ? <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> : <Wrench className="w-3 h-3 mt-0.5 shrink-0 text-amber-400" />}
                  <span className="break-all">{msg.content}</span>
                </div>
              ) : (
                <div key={msg.id} className={`flex gap-3 max-w-[88%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-signal text-ink-950' : 'bg-ink-850 border border-line'}`}>
                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-signal-soft" />}
                  </div>
                  <div
                    className={`p-3 rounded-xl text-[13px] ${
                      msg.role === 'user'
                        ? 'bg-signal text-ink-950 rounded-tr-sm'
                        : msg.isError
                        ? 'bg-neg/10 text-neg border border-neg/25 rounded-tl-sm'
                        : 'bg-ink-850 text-slate-200 border border-line rounded-tl-sm'
                    }`}
                  >
                    <p className="leading-relaxed whitespace-pre-wrap break-words">
                      {msg.content || (msg.isStreaming ? 'Working…' : '')}
                      {msg.isStreaming && <span className="ml-1">▋</span>}
                    </p>
                  </div>
                </div>
              )
            )
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3.5 border-t border-line shrink-0">
          <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isProcessing}
              placeholder="Buy X for $20, sell Y, set TP to 100%…"
              className="field flex-1"
              aria-label="Ask the AI copilot"
            />
            <button
              type="submit"
              disabled={!input.trim() || isProcessing}
              className="btn btn-primary w-9 px-0 shrink-0"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      </div>
    </>
  );
};
