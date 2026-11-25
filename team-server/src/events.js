// Server-sent events: live sidebar, comment and notification updates per user.
const clients = new Map(); // userId -> Set<res>

export function subscribe(userId, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => { clearInterval(ping); clients.get(userId)?.delete(res); });
}

export function sendTo(userIds, event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const id of new Set(userIds)) for (const res of clients.get(id) || []) res.write(data);
}
