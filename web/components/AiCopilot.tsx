'use client';

import { useState, useRef, useEffect } from 'react';
import { Markdown } from './Markdown';

// What each tool did, in plain words, for the badges above an answer
const TOOL_LABELS: Record<string, string> = {
  searchOpportunities: 'Searched your calls',
  getOpportunityDetails: 'Read call details',
  getWhyRecommended: 'Checked why it matches',
  getUserProfile: 'Read your profile',
  saveOpportunity: 'Saved a call'
};

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: Array<{ name: string; args: any }>;
  timestamp: string;
}

const INITIAL_MESSAGE: ChatEntry = {
  id: 'welcome',
  role: 'assistant',
  content: `**Hi! Ask me about your funding calls.** For example:\n\n- *Which open calls fit my research?*\n- *What closes before December?*\n- *Why was this call recommended to me?*`,
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
};

export function AiCopilot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatEntry[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (open) {
      scrollToBottom();
    }
  }, [messages, open]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    const userEntry: ChatEntry = {
      id: Math.random().toString(36).slice(2),
      role: 'user',
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userEntry]);
    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          session_id: sessionId || undefined
        })
      });

      const data = await res.json();
      if (res.ok && data) {
        if (data.session_id) {
          setSessionId(data.session_id);
        }

        const assistantEntry: ChatEntry = {
          id: Math.random().toString(36).slice(2),
          role: 'assistant',
          content: data.message || 'No response generated.',
          tools: data.tools_executed,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages((prev) => [...prev, assistantEntry]);
      } else {
        const errorMsg = data?.error?.message || 'Failed to reach Research Copilot.';
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: 'assistant',
            content: `**Something went wrong.** ${errorMsg}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).slice(2),
          role: 'assistant',
          content: '**Could not reach the Copilot.** Check your connection and try again.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating Trigger Button */}
      <div className="fixed bottom-20 lg:bottom-6 right-4 sm:right-6 z-40">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 min-h-11 px-4 rounded-full bg-primary text-on-primary font-semibold surface-card hover:bg-primary-fixed transition-colors"
          title="Ask about your calls"
          aria-label="Research Copilot: ask about your calls"
          aria-expanded={open}
        >
          <span className="material-symbols-outlined text-[20px] sm:text-[22px]" aria-hidden="true">auto_awesome</span>
          <span className="font-body-md text-body-md hidden sm:inline">Research Copilot</span>
        </button>
      </div>

      {/* Slide-out / Floating Panel */}
      {open && (
        <div className="fixed inset-x-2 sm:inset-x-auto sm:right-6 bottom-20 z-50 sm:w-[440px] max-h-[calc(100vh-6rem)] h-[75vh] flex flex-col bg-surface surface-card rounded-2xl overflow-hidden">
          {/* Copilot Header */}
          <div className="px-4 py-3.5 bg-surface-container-high border-b border-outline-variant/30 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[18px]">psychology</span>
              </div>
              <div>
                <h3 className="font-headline-sm text-body-md text-on-surface font-bold">
                  AI Research Copilot
                </h3>
                <span className="font-data-mono-sm text-[11px] text-on-surface-variant flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block animate-pulse"></span>
                  Answers from your calls and profile
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setMessages([INITIAL_MESSAGE])}
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                title="Start a new conversation"
                aria-label="Start a new conversation"
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">restart_alt</span>
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                title="Close"
                aria-label="Close Copilot"
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 font-body-sm text-body-sm" aria-live="polite">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] p-3.5 rounded-xl ${
                    m.role === 'user'
                      ? 'bg-primary text-on-primary font-medium rounded-br-none'
                      : 'bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-bl-none'
                  }`}
                >
                  {/* Tool Execution Badges */}
                  {m.tools && m.tools.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {m.tools.map((t, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container/40 border border-secondary/30 text-secondary text-[11px] font-data-mono-sm"
                        >
                          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">check</span>
                          {TOOL_LABELS[t.name] ?? t.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Message Content */}
                  {m.role === 'assistant' ? <Markdown text={m.content} /> : <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>}
                </div>
                <span className="text-[10px] text-on-surface-variant/60 font-data-mono-sm mt-1 px-1">
                  {m.timestamp}
                </span>
              </div>
            ))}

            {loading && (
              <div className="flex items-start">
                <div className="p-3.5 rounded-xl bg-surface-container-lowest border border-outline-variant/30 text-on-surface flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                  <span className="font-data-mono-sm text-[12px] text-on-surface-variant">
                    Looking through your calls…
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompt Chips */}
          <div className="px-3 py-2 bg-surface-container-lowest border-t border-outline-variant/20 flex items-center gap-1.5 overflow-x-auto text-[11px] whitespace-nowrap">
            <button
              onClick={() => handleSend('Which open calls fit my research?')}
              className="px-2.5 py-1 rounded-full bg-surface-container border border-outline-variant/40 hover:bg-surface-container-high transition-colors text-on-surface-variant"
            >
              🔍 Calls for me
            </button>
            <button
              onClick={() => handleSend('Show my profile keywords')}
              className="px-2.5 py-1 rounded-full bg-surface-container border border-outline-variant/40 hover:bg-surface-container-high transition-colors text-on-surface-variant"
            >
              👤 My keywords
            </button>
            <button
              onClick={() => handleSend('Find journal special issues')}
              className="px-2.5 py-1 rounded-full bg-surface-container border border-outline-variant/40 hover:bg-surface-container-high transition-colors text-on-surface-variant"
            >
              📚 Journal issues
            </button>
          </div>

          {/* Input Box */}
          <div className="p-3 bg-surface-container-high border-t border-outline-variant/30 flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about calls, deadlines or eligibility…"
              aria-label="Message to the Copilot"
              rows={1}
              className="flex-1 resize-none px-3.5 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 text-body-sm focus:border-primary focus:outline-none max-h-24"
            />
            <button
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              className="p-2.5 rounded-xl bg-primary text-on-primary hover:bg-primary-fixed-dim transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              title="Send"
              aria-label="Send message"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">send</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
