export function subscribeSpec(id: string, onUpdated: () => void): () => void {
  const source = new EventSource(`/api/specs/${encodeURIComponent(id)}/events`)
  source.addEventListener('updated', () => onUpdated())
  source.addEventListener('error', () => {
    // EventSource auto-reconnects; nothing to do here.
  })
  return () => source.close()
}
