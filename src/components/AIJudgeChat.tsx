'use client';

import React, { useState, useRef, useEffect } from 'react';
import { AIService } from '@/services/ai.service';
import { useCoinStore } from '@/store/useCoinStore';
import { Send, Bot, User, Loader2, X, MessageSquare } from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export const AIJudgeChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { selectedCoin, aiAnalysis } = useCoinStore();

  // Auto-scroll on new content
  useEffect(() => {
    if (isOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (selectedCoin && isOpen) {
      const autoPrompt = `Tell me about ${selectedCoin.name} (${selectedCoin.symbol})`;
      setInput(autoPrompt);
    }
  }, [selectedCoin, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    };

    const assistantPlaceholderId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, userMessage, {
      id: assistantPlaceholderId,
      role: 'assistant',
      content: '',
      isStreaming: true
    }]);
    
    setInput('');
    setIsProcessing(true);

    try {
      await AIService.judgeCoin(
        userMessage.content,
        (chunk) => {
          setMessages(prev => prev.map(msg => 
            msg.id === assistantPlaceholderId 
              ? { ...msg, content: msg.content + chunk } 
              : msg
          ));
        },
        { coin: selectedCoin, aiAnalysis }
      );
    } catch (err) {
      setMessages(prev => prev.map(msg => 
        msg.id === assistantPlaceholderId 
          ? { ...msg, content: "Connection to AI Judge failed. Please try again." } 
          : msg
      ));
    } finally {
      setIsProcessing(false);
      setMessages(prev => prev.map(msg => 
        msg.id === assistantPlaceholderId 
          ? { ...msg, isStreaming: false } 
          : msg
      ));
    }
  };

  return (
    <>
      {/* Floating Chat Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 z-50 p-4 rounded-2xl shadow-2xl transition-all duration-300 ${
          isOpen
            ? 'bg-ink-800 text-slate-400 hover:text-white scale-90 opacity-0 pointer-events-none'
            : 'bg-signal text-ink-950 hover:bg-signal-soft hover:scale-105'
        }`}
        aria-label="Open AI Judge Chat"
      >
        <MessageSquare className="w-6 h-6" />
        <span className="absolute top-0 right-0 flex h-3 w-3 -mt-1 -mr-1">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
        </span>
      </button>

      <div
        className={`fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] flex flex-col h-[600px] max-h-[calc(100vh-6rem)] surface rounded-2xl overflow-hidden shadow-2xl shadow-black/40 transition-all duration-300 origin-bottom-right ${
          isOpen ? 'scale-100 opacity-100' : 'scale-50 opacity-0 pointer-events-none'
        }`}
      >
        <div className="p-4 border-b border-white/8 bg-ink-850/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-signal/15 p-2 rounded-xl">
              <Bot className="w-5 h-5 text-signal-soft" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-sm">AI Judge Assistant</h2>
              <p className="text-xs text-slate-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                Online
              </p>
            </div>
          </div>
          <button 
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-slate-700 rounded-xl transition-colors text-slate-400 hover:text-white"
            aria-label="Close chat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 p-4 overflow-y-auto space-y-4 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
              <div className="bg-signal/10 p-4 rounded-2xl">
                <Bot className="w-8 h-8 text-signal/50" />
              </div>
              <div className="text-center">
                <p className="text-sm text-slate-300 font-medium mb-1">How can I help you?</p>
                <p className="text-xs text-slate-500">Ask about market risks, fundamental shifts,<br />or technical patterns.</p>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}>
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  msg.role === 'user' ? 'bg-signal text-ink-950' : 'bg-ink-850 border border-white/10'
                }`}>
                  {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-signal-soft" />}
                </div>
                <div className={`p-3 rounded-2xl text-sm ${
                  msg.role === 'user'
                    ? 'bg-signal text-ink-950 rounded-tr-sm'
                    : 'bg-ink-850 text-slate-200 border border-white/8 rounded-tl-sm'
                }`}>
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.content}{msg.isStreaming && <span className="animate-pulse ml-1">▋</span>}</p>
                </div>
              </div>
            ))
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
              placeholder="Ask about a coin..."
              className="flex-1 bg-ink-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/30 transition-colors disabled:opacity-50"
              aria-label="Ask the AI Judge"
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
