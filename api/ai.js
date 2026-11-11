// Vercel serverless function: নিরাপদে Gemini কল করে (API key থাকে Vercel-এর Environment Variable-এ)
// উত্তর স্ট্রিম করে আনে; মডেল ব্যস্ত বা আটকে গেলে পরের মডেলে যায়; ব্যর্থ হলে কী ঘটেছে তার লগ দেখায়।
const MODELS = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [])
  .concat(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'])
  .filter((m, i, a) => a.indexOf(m) === i);
const IDLE_MS = +process.env.IDLE_MS || 25000;   // এতক্ষণ কোনো ডেটা না এলে আটকে গেছে ধরা হবে
const TOTAL_MS = +process.env.TOTAL_MS || 55000; // মোট সময়ের বাজেট (Vercel সীমা ৬০ সেকেন্ড)

async function callModel(model, key, body, deadline) {
  const ac = new AbortController();
  let idle;
  const arm = () => { clearTimeout(idle); idle = setTimeout(() => ac.abort(), IDLE_MS); };
  const hard = setTimeout(() => ac.abort(), Math.max(1000, deadline - Date.now()));
  arm();
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: ac.signal,
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: false, status: r.status, error: (j.error && j.error.message) || ('HTTP ' + r.status) };
    }
    const rd = r.body.getReader(), dec = new TextDecoder();
    let buf = '', text = '';
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      arm();
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('data:')) {
          try {
            const j = JSON.parse(line.slice(5));
            text += ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [])
              .map(p => p.text || '').join('');
          } catch (e) { /* অসম্পূর্ণ লাইন — উপেক্ষা */ }
        }
      }
    }
    return text ? { ok: true, text } : { ok: false, status: 200, error: 'খালি উত্তর' };
  } catch (e) {
    return { ok: false, status: 0, error: ac.signal.aborted ? 'সাড়া আসেনি' : String((e && e.message) || e) };
  } finally {
    clearTimeout(idle); clearTimeout(hard);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'শুধু POST চলবে' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Vercel-এ GEMINI_API_KEY সেট করা নেই' });
  const { prompt, images = [] } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt পাওয়া যায়নি' });
  const parts = [
    ...images.map(i => ({ inline_data: { mime_type: i.mime || 'image/jpeg', data: i.data } })),
    { text: prompt },
  ];
  const mk = think => JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: Object.assign({ temperature: 0, responseMimeType: 'application/json' },
      think ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
  });
  const t0 = Date.now(), deadline = t0 + TOTAL_MS, log = [];
  for (const model of MODELS) {
    for (const think of [true, false]) {
      if (deadline - Date.now() < 6000) break;
      const t1 = Date.now();
      const r = await callModel(model, key, mk(think), deadline);
      log.push(`${model}${think ? '' : ' (no-think)'}: ${r.ok ? 'ok' : (r.status + ' ' + r.error).slice(0, 70)} [${Math.round((Date.now() - t1) / 1000)}s]`);
      if (r.ok) return res.status(200).json({ text: r.text, model });
      if (r.status === 401 || r.status === 403) return res.status(r.status).json({ error: r.error });
      if (r.status === 400 && think) continue;
      break;
    }
  }
  return res.status(503).json({ error: 'Gemini থেকে উত্তর পাওয়া যায়নি, কিছুক্ষণ পর আবার চেষ্টা করুন। লগ → ' + log.join(' | ') });
};
