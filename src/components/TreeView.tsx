import React, { useState } from 'react';
import { FileNode } from '../types';
import { ChevronRight, ChevronDown, FileCode, FileJson, FileType2, Image, FileText } from 'lucide-react';
import { cn } from '../lib/utils';

interface TreeViewProps {
  nodes: FileNode[];
  level?: number;
}

const FileIcon = ({ name }: { name: string }) => {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'tsx':
    case 'ts':
    case 'jsx':
    case 'js':
      return <FileType2 className="w-3 h-3 text-blue-300" />;
    case 'css':
      return <FileCode className="w-3 h-3 text-sky-400" />;
    case 'json':
      return <FileJson className="w-3 h-3 text-yellow-500" />;
    case 'svg':
    case 'png':
    case 'jpg':
      return <Image className="w-3 h-3 text-purple-400" />;
    default:
      return <FileText className="w-3 h-3 text-[#A1A1AA]" />;
  }
};

const TreeNode: React.FC<{ node: FileNode; level: number }> = ({ node, level }) => {
  const [isOpen, setIsOpen] = useState(true);

  if (node.type === 'folder') {
    return (
      <div className="w-full">
        <div 
          className="flex items-center gap-2 py-1 text-sm cursor-pointer group hover:bg-[#1A1A1A] rounded"
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className="text-[#A1A1AA] group-hover:text-white">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
          <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
          <span className="font-medium text-[#E5E5E5]">{node.name}</span>
        </div>
        {isOpen && node.children && (
          <div className="flex flex-col">
            {node.children.map(child => (
              <TreeNode key={child.id} node={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      className="flex items-center gap-2 py-1 text-sm text-[#A1A1AA] hover:text-white cursor-pointer hover:bg-[#1A1A1A] rounded"
      style={{ paddingLeft: `${level * 16 + 8 + 24}px` }}
    >
      <FileIcon name={node.name} />
      <span>{node.name}</span>
    </div>
  );
};

export const TreeView: React.FC<TreeViewProps> = ({ nodes, level = 0 }) => {
  return (
    <div className="flex flex-col w-full font-sans">
      {nodes.map(node => (
        <TreeNode key={node.id} node={node} level={level} />
      ))}
    </div>
  );
};
