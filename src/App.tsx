/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useStore } from './store';
import { TreeView } from './components/TreeView';
import { CopilotChat } from './components/CopilotChat';
import { Button } from './components/ui/button';
import { Database, LayoutTemplate } from 'lucide-react';
import { ScrollArea } from './components/ui/scroll-area';

export default function App() {
  const { tree, loadMockRepo } = useStore();

  return (
    <div className="flex w-screen h-screen bg-[#0A0A0A] text-[#E5E5E5] overflow-hidden font-sans border border-[#262626]">
      
      {/* Left Pane: Repository Viewer */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-[#262626] bg-[#0C0C0C]">
        {/* Header */}
        <div className="h-14 border-b border-[#262626] bg-[#0A0A0A] flex items-center justify-between p-4 shrink-0">
          <div className="flex items-center gap-3">
            <LayoutTemplate className="w-4 h-4 text-blue-500" />
            <h1 className="text-sm font-semibold tracking-tight">Visual Repository Planner</h1>
          </div>
          
          <button 
            onClick={loadMockRepo}
            className="px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#262626] border border-[#333] rounded text-[11px] font-medium transition-colors text-[#E5E5E5] flex items-center gap-2"
          >
            <Database className="w-3.5 h-3.5" />
            Load Mock Repo
          </button>
        </div>
        
        {/* Tree Canvas/Viewer Area */}
        <ScrollArea className="flex-1 p-4 w-full">
          {tree.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#525252] space-y-4 pt-20">
              <FolderIcon className="w-12 h-12 text-[#262626]" />
              <p className="text-sm">Repository is empty</p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="px-4 py-2 flex gap-4 text-[11px] text-[#A1A1AA] uppercase tracking-wider mb-2">
                <span className="text-[#525252]">PROJECT ROOT</span>
              </div>
              <TreeView nodes={tree} />
            </div>
          )}
        </ScrollArea>
      </div>
      
      {/* Right Pane: AI Copilot */}
      <div className="w-[384px] shrink-0 h-full flex flex-col bg-[#0A0A0A]">
        <CopilotChat />
      </div>
    </div>
  );
}

const FolderIcon = (props: any) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </svg>
);
