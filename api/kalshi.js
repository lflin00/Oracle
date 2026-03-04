export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { horizon } = req.query;
  const now = new Date();
  const params = new URLSearchParams({ status: 'open', limit: '100' });

  if (horizon === 'ultrashort') {
    const d = new Date(now); d.setHours(now.getHours() + 48);
    params.append('max_close_ts', Math.floor(d.getTime() / 1000));
  } else if (horizon === 'short') {
    const d = new Date(now); d.setDate(now.getDate() + 14);
    params.append('max_close_ts', Math.floor(d.getTime() / 1000));
  } else if (horizon === 'medium') {
    const d2 = new Date(now); d2.setDate(now.getDate() + 14);
    const d = new Date(now); d.setMonth(now.getMonth() + 3);
    params.append('min_close_ts', Math.floor(d2.getTime() / 1000));
    params.append('max_close_ts', Math.floor(d.getTime() / 1000));
  } else {
    const d = new Date(now); d.setMonth(now.getMonth() + 3);
    params.append('min_close_ts', Math.floor(d.getTime() / 1000));
  }

  try {
    const response = await fetch(
      `https://api.elections.kalshi.com/trade-api/v2/markets?${params.toString()}`
    );
    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
