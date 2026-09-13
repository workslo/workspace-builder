import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Send, Bot, User, Check, GitCommit, Loader2 } from 'lucide-react';
import { TreeDiff } from '../types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  diffs?: TreeDiff[];
  diffApplied?: boolean;
}

export const CopilotChat: React.FC = () => {
  const { tree, applyDiffs } = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'intro',
    role: 'assistant',
    content: "Hi! I'm your repo architect. Need a new component structure, hooks directory, or complete feature scaffold?"
  }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: input,
          currentStructure: tree
        })
      });
      
      const data = await response.json();
      
      if (data.diffs) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: data.thoughts || "I've generated a requested structure update.",
          diffs: data.diffs
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: "I couldn't generate a valid structure change for that request."
        }]);
      }

    } catch (error) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: "Sorry, I ran into an error processing your request."
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyDiffs = (messageId: string, diffs: TreeDiff[]) => {
    applyDiffs(diffs);
    setMessages(prev => prev.map(msg => 
      msg.id === messageId ? { ...msg, diffApplied: true } : msg
    ));
  };

  return (
    <div className="flex flex-col h-full bg-[#0A0A0A] w-full">
      <div className="p-4 border-b border-[#262626]">
        <h2 className="text-xs font-bold text-[#A1A1AA] uppercase tracking-widest flex items-center gap-2">
          <Bot className="w-4 h-4 text-blue-500" />
          AI Architect Copilot
        </h2>
      </div>
      
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-6">
          {messages.map((msg, index) => (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              
                {msg.role === 'user' ? (
                  <div className="bg-[#1A1A1A] p-3 rounded-lg rounded-tr-none max-w-[90%] border border-[#262626]">
                    <p className="text-xs leading-relaxed text-[#E5E5E5]">{msg.content}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-start w-full">
                    <div className="p-1 mb-2">
                      <p className="text-xs text-[#A1A1AA]">{msg.content}</p>
                    </div>
                  
                    {msg.diffs && msg.diffs.length > 0 && (
                      <div className="w-full bg-[#111111] border border-[#262626] rounded-xl overflow-hidden mt-2">
                        <div className="p-3 bg-[#1A1A1A] border-b border-[#262626] flex justify-between items-center">
                          <span className="text-[10px] font-mono text-blue-400 flex items-center gap-2">
                            <GitCommit className="w-3 h-3" />
                            PROPOSED_DIFF
                          </span>
                          <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded">
                            {msg.diffs.length} changes
                          </span>
                        </div>
                        <div className="p-4 font-mono text-[11px] leading-6 max-h-60 overflow-y-auto custom-scrollbar">
                          {msg.diffs.map((d, i) => (
                            <div key={i} className={`flex gap-2 ${d.action === 'add' ? 'text-green-500/80' : 'text-red-500/80'}`}>
                              <span className="w-4">{d.action === 'add' ? '+' : '-'}</span>
                              <span>{d.path}</span>
                            </div>
                          ))}
                        </div>
                        
                        <button 
                          disabled={msg.diffApplied}
                          onClick={() => handleApplyDiffs(msg.id, msg.diffs!)}
                          className={`w-full py-3 text-[11px] font-bold tracking-tight transition-all flex items-center justify-center gap-2 ${msg.diffApplied ? 'bg-[#1A1A1A] text-[#A1A1AA] cursor-not-allowed border-t border-[#262626]' : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-[0.98]'}`}
                        >
                          {msg.diffApplied ? (
                            <><Check className="w-3 h-3" /> CHANGES APPLIED & TREE PATCHED</>
                          ) : (
                            'ACCEPT CHANGES & PATCH TREE'
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

            </div>
          ))}
          {isLoading && (
             <div className="flex flex-col items-start w-full">
               <div className="p-1 mb-2 flex items-center gap-2">
                 <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                 <p className="text-xs text-[#A1A1AA]">Analyzing architecture...</p>
               </div>
             </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>
      
      <div className="p-4 border-t border-[#262626] bg-[#0C0C0C]">
        <form onSubmit={handleSubmit} className="relative">
          <textarea 
            className="w-full bg-[#1A1A1A] border border-[#262626] rounded-lg p-3 pr-12 text-xs text-[#E5E5E5] placeholder:text-[#525252] focus:outline-none focus:border-blue-500/50 resize-none"
            rows={3}
            placeholder="Ask for architectural changes..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as any);
              }
            }}
            disabled={isLoading}
          ></textarea>
          <div className="absolute bottom-3 right-3 flex gap-2">
            <button 
              type="submit"
              disabled={!input.trim() || isLoading}
              className="p-1.5 bg-[#0A0A0A] hover:bg-[#111] rounded border border-[#262626] text-[10px] text-[#A1A1AA] transition-colors disabled:opacity-50"
            >
              <Send className="w-3 h-3" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
