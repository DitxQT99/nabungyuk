export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb'
    }
  }
};

import { createUserIfNotExists, updateBalance, getUser, clearHistory } from './Base.js';

export default async function handler(req, res) {

  if (req.method === 'GET') {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId diperlukan' });

    const user = createUserIfNotExists(userId);
    return res.status(200).json(user);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, userId, amount, image } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId diperlukan' });
    }

    createUserIfNotExists(userId);

    // ================= WITHDRAW =================
    if (type === 'withdraw') {

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Nominal tidak valid' });
      }

      const user = getUser(userId);

      if (user.balance < amount) {
        return res.status(400).json({ error: 'Saldo tidak cukup' });
      }

      const updated = updateBalance(userId, -amount, {
        amount: -amount,
        status: 'WITHDRAW',
        date: new Date().toISOString()
      });

      return res.status(200).json({
        total: updated.balance,
        history: updated.history
      });
    }

    // ================= CLEAR =================
    if (type === 'clear') {
      const user = clearHistory(userId);
      return res.status(200).json({
        balance: user.balance,
        history: user.history
      });
    }

    // ================= DEPOSIT =================
    if (type !== 'deposit') {
      return res.status(400).json({ error: 'Tipe transaksi tidak dikenal' });
    }

    if (!image || !amount) {
      return res.status(400).json({ error: 'Image dan amount wajib diisi' });
    }

    // 🔥 POTONG BASE64 JIKA TERLALU BESAR (ANTI 4MB LIMIT)
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    if (base64Data.length > 3_500_000) {
      return res.status(400).json({
        error: 'Ukuran gambar terlalu besar. Gunakan resolusi lebih kecil.'
      });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'API Key tidak ditemukan di environment variable' });
    }

const geminiRes = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: `Validasi uang Rp ${amount}. Balas JSON saja.` },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: base64Data
            }
          }
        ]
      }]
    })
  }
);
    

    // ❗ WAJIB CEK RESPONSE OK
    if (!geminiRes.ok) {
      const textError = await geminiRes.text();
      return res.status(500).json({
        error: 'Gemini API Error',
        detail: textError
      });
    }

    const geminiData = await geminiRes.json();

    const aiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      return res.status(500).json({
        error: 'AI tidak merespon dengan benar'
      });
    }

    let result;

    try {
      result = JSON.parse(aiText);
    } catch {
      return res.status(500).json({
        error: 'AI tidak mengembalikan JSON valid',
        raw: aiText
      });
    }

    // ================= UPDATE SALDO =================
    if (result.final_decision?.status === 'ACCEPTED') {

      const updated = updateBalance(userId, amount, {
        amount,
        status: 'ACCEPTED',
        date: new Date().toISOString()
      });

      return res.status(200).json({
        ...result,
        total: updated.balance,
        history: updated.history
      });
    }

    const user = getUser(userId);

    return res.status(200).json({
      ...result,
      total: user.balance,
      history: user.history
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Server error',
      detail: err.message
    });
  }
}
