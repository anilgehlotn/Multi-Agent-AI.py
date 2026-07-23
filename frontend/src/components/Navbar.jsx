import { NavLink } from 'react-router-dom';
import { Zap, ExternalLink } from 'lucide-react';

export default function Navbar() {
  return (
    <nav className="bg-white border-b" style={{ borderColor: 'var(--color-border)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ── Logo ─────────────────────────────────────────────── */}
          <NavLink to="/" className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-btn-primary-bg)' }}
            >
              <Zap size={16} className="text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
              ResearchMind
            </span>
          </NavLink>

          {/* ── Center nav links ─────────────────────────────────── */}
          <div className="hidden sm:flex items-center gap-8">
            <NavLink
              to="/"
              end
              className="text-sm font-medium transition-colors"
              style={({ isActive }) => ({ color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)' })}
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/history"
              className="text-sm font-medium transition-colors"
              style={({ isActive }) => ({ color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)' })}
            >
              History
            </NavLink>
            <NavLink
              to="/evals"
              className="text-sm font-medium transition-colors"
              style={({ isActive }) => ({ color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)' })}
            >
              Evaluations
            </NavLink>
            <span
              className="text-sm cursor-not-allowed"
              style={{ color: 'var(--color-text-muted)' }}
              title="Coming soon"
            >
              Settings
            </span>
          </div>

          {/* ── Right icons ──────────────────────────────────────── */}
          <div className="flex items-center gap-3">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
              style={{ backgroundColor: 'var(--color-border-light)' }}
              id="github-link"
              title="View source"
            >
              <ExternalLink size={16} style={{ color: 'var(--color-text-secondary)' }} />
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
}
