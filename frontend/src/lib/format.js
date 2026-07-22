// date-fns isn't a dependency here, and pulling it in just for one function
// is more weight than this needs — a tiny inline helper covers it.
export function timeAgo(dateInput) {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput.endsWith('Z') ? dateInput : `${dateInput}Z`) : dateInput;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function elapsedMMSS(sinceDateInput) {
  if (!sinceDateInput) return '00:00';
  const since = typeof sinceDateInput === 'string' ? new Date(sinceDateInput.endsWith('Z') ? sinceDateInput : `${sinceDateInput}Z`) : sinceDateInput;
  const totalSeconds = Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
