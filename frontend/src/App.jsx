import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import History from './pages/History';
import ResearchRunDetail from './pages/ResearchRunDetail';
import RagSessionDetail from './pages/RagSessionDetail';
import EvalsPage from './pages/EvalsPage';

export default function App() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-page-bg)' }}>
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12 -mt-4">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/research/:id" element={<ResearchRunDetail />} />
          <Route path="/history/rag/:id" element={<RagSessionDetail />} />
          <Route path="/evals" element={<EvalsPage />} />
        </Routes>
      </main>
    </div>
  );
}
