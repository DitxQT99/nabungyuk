export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb' // Perbesar limit untuk upload gambar
    }
  }
};

import { createUserIfNotExists, updateBalance, getUser, clearHistory } from '../Database.js';

export default async function handler(req, res) {
  // GET: ambil data user
  if (req.method === 'GET') {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId diperlukan' });

    const user = createUserIfNotExists(userId);
    return res.status(200).json(user);
  }

  // POST: deposit/withdraw/clear
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, userId, amount, image } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId diperlukan' });
    }

    // Pastikan user ada
    createUserIfNotExists(userId);

    // ========== WITHDRAW ==========
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

    // ========== CLEAR HISTORY ==========
    if (type === 'clear') {
      const user = clearHistory(userId);
      return res.status(200).json({
        balance: user.balance,
        history: user.history
      });
    }

    // ========== DEPOSIT (dengan AI) ==========
    if (type !== 'deposit') {
      return res.status(400).json({ error: 'Tipe transaksi tidak dikenal' });
    }

    if (!image || !amount) {
      return res.status(400).json({ error: 'Image dan amount wajib diisi' });
    }

    // Ekstrak base64 tanpa header
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    // Cek ukuran (opsional, karena sudah diatur di bodyParser)
    if (base64Data.length > 3_500_000) {
      return res.status(400).json({ error: 'Ukuran gambar terlalu besar. Gunakan resolusi lebih kecil.' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'API Key tidak ditemukan di environment variable' });
    }

    // Prompt untuk Gemini
    const prompt = `
Anda adalah AI validator uang. Tugas: periksa apakah foto ini adalah uang kertas Rupiah asli dengan nominal yang sesuai.
User ingin menabung Rp ${amount}. Analisis gambar, lalu berikan output JSON dengan format berikut:

{
  "analysis": {
    "object_detected_as_money": true/false,
    "currency": "IDR / UNKNOWN",
    "image_clear": true/false,
    "suspected_fake_or_edit": true/false,
    "detected_nominal": number,
    "confidence_level": 0-100
  },
  "validation": {
    "input_nominal": ${amount},
    "match_exact": true/false
  },
  "final_decision": {
    "status": "ACCEPTED / REJECTED_NOT_MONEY / REJECTED_UNCLEAR_IMAGE / REJECTED_AMOUNT_MISMATCH",
    "reason": "penjelasan singkat"
  }
}

Gunakan hanya JSON, tanpa teks lain.
`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
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

    if (!geminiRes.ok) {
      const errorText = await geminiRes.text();
      return res.status(500).json({ error: 'Gemini API Error', detail: errorText });
    }

    const geminiData = await geminiRes.json();
    const aiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      return res.status(500).json({ error: 'AI tidak merespon dengan benar' });
    }

    // Bersihkan JSON jika ada markdown
    let cleaned = aiText.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/```json\n?/, '').replace(/```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```\n?/, '').replace(/```$/, '');
    }

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({ error: 'AI tidak mengembalikan JSON valid', raw: aiText });
    }

    // Jika diterima (ACCEPTED dan confidence >= 85), update saldo
    if (result.final_decision?.status === 'ACCEPTED' && result.analysis?.confidence_level >= 85) {
      const updated = updateBalance(userId, amount, {
        amount,
        status: 'ACCEPTED',
        confidence: result.analysis.confidence_level,
        reason: result.final_decision.reason,
        date: new Date().toISOString()
      });

      return res.status(200).json({
        ...result,
        total: updated.balance,
        history: updated.history
      });
    }

    // Jika ditolak, tetap simpan ke history sebagai rejected
    updateBalance(userId, 0, {
      amount: 0,
      status: result.final_decision?.status || 'REJECTED',
      confidence: result.analysis?.confidence_level || 0,
      reason: result.final_decision?.reason || 'Ditolak oleh AI',
      date: new Date().toISOString()
    });

    const user = getUser(userId);
    return res.status(200).json({
      ...result,
      total: user.balance,
      history: user.history
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}