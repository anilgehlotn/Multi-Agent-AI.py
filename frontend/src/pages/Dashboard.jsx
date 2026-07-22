import { useState } from 'react';
import ResearchTab from '../components/ResearchTab';
import RagTab from '../components/RagTab';
import { FlaskConical, BookOpen } from 'lucide-react';

const TABS = [
  { id: 'research', label: 'Research Agent', icon: FlaskConical },
  { id: 'rag', label: 'Book Q&A (RAG)', icon: BookOpen },
];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('research');

  return (
    <div
      className="bg-white"
      style={{
        borderRadius: 'var(--radius-panel)',
        boxShadow: 'var(--shadow-panel)',
        minHeight: 'calc(100vh - 140px)',
      }}
    >
      {/* ── Tab switcher ────────────────────────────────────────── */}
      <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors cursor-pointer"
              style={{
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                borderTopLeftRadius: tab.id === 'research' ? 'var(--radius-panel)' : 0,
              }}
            >
              <Icon size={16} />
              {tab.label}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5"
                  style={{ backgroundColor: 'var(--color-text-primary)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}
      <div className="p-6 sm:p-8">
        {activeTab === 'research' && <ResearchTab />}
        {activeTab === 'rag' && <RagTab />}
      </div>
    </div>
  );
}
