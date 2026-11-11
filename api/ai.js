// Vercel serverless function: নিরাপদে Gemini কল করে (API key থাকে Vercel-এর Environment Variable-এ)
// একটা মডেল ব্যস্ত/ব্যর্থ হলে নিজে থেকেই পরের মডেলে চেষ্টা করে।
const MODELS = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [])
  .concat(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'])
  .filter((m, i, a) => a.indexOf(m) === i);

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
  const t0 = Date.now();
  let last = 'Gemini সাড়া দেয়নি';
  for (const model of MODELS) {
    for (const think of [true, false]) {
      const rem = 55000 - (Date.now() - t0);
      if (rem < 8000) break;
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: mk(think),
          signal: AbortSignal.timeout(rem),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [])
            .map(p => p.text || '').join('');
          if (text) return res.status(200).json({ text, model });
          last = 'Gemini খালি উত্তর দিয়েছে';
          break;
        }
        last = (j.error && j.error.message) || ('Gemini ত্রুটি ' + r.status);
        if (r.status === 401 || r.status === 403) return res.status(r.status).json({ error: last });
        if (r.status === 400 && think) continue; // thinking সেটিং না মানলে সেটা ছাড়া আবার
        break;
      } catch (e) {
        last = 'Gemini-র সাড়া পেতে দেরি হয়েছে';
        break;
      }
    }
  }
  return res.status(503).json({ error: 'এখন সব মডেল ব্যস্ত, ১–২ মিনিট পর আবার চেষ্টা করুন। (' + last + ')' });
};
