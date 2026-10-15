// Collapse bursts and allow only one refresh at a time, retaining events received in flight.
export function createRefreshQueue(refresh, onError, delay = 500) {
  const pending = new Map();
  let timer = null;
  let running = false;
  function schedule() {
    if (!running && timer === null && pending.size) timer = setTimeout(flush, delay);
  }
  async function flush() {
    timer = null;
    running = true;
    const events = [...pending.values()];
    pending.clear();
    try { await refresh(events); }
    catch (error) { onError(error); }
    finally { running = false; schedule(); }
  }
  return event => {
    pending.set(`${event.type}:${event.conversationId || ''}`, event);
    schedule();
  };
}
