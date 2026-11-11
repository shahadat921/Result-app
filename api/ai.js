// Vercel serverless function: নিরাপদে Gemini কল করে (API key থাকে Vercel-এর Environment Variable-এ)
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'শুধু POST চলবে' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Vercel-এ GEMINI_API_KEY সেট করা নেই' });
  const { prompt, images = [] } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt পাওয়া যায়নি' });
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const parts = [
    ...images.map(i => ({ inline_data: { mime_type: i.mime || 'image/jpeg', data: i.data } })),
    { text: prompt },
  ];
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (j.error && j.error.message) || 'Gemini ত্রুটি' });
    const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [])
      .map(p => p.text || '').join('');
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
