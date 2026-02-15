import { createUserIfNotExists, updateBalance, getUser, clearHistory } from './Base.js';

export default async function handler(req, res) {
  // GET: ambil data user
  if (req.method === 'GET') {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId diperlukan' });

    const user = createUserIfNotExists(userId);
    return res.status(200).json(user);
  }

  // POST: deposit (dengan AI) atau withdraw / clear
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, userId, amount, image } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId diperlukan' });

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

      return res.status(200).json({ total: updated.balance, history: updated.history });
    }

    // ========== CLEAR HISTORY ==========
    if (type === 'clear') {
      const user = clearHistory(userId);
      return res.status(200).json({ balance: user.balance, history: user.history });
    }

    // ========== DEPOSIT (DENGAN AI) ==========
    if (type !== 'deposit') {
      return res.status(400).json({ error: 'Tipe transaksi tidak dikenal' });
    }

    if (!image || !amount) {
      return res.status(400).json({ error: 'Image dan amount wajib diisi' });
    }

    // Prompt Gemini (sama seperti sebelumnya)
    const prompt = `
Halo Gemini,

Kamu adalah AI Vision Financial Validator khusus untuk mendeteksi dan memverifikasi uang kertas Rupiah Indonesia secara ketat dan detail.

KONTEKS:
User ingin menabung sebesar: ${amount}
Gambar yang diberikan adalah bukti foto uang.

====================================================
TUGAS UTAMA
====================================================

1. Analisa apakah gambar adalah uang kertas Rupiah Indonesia asli.
2. Identifikasi nominal secara akurat.
3. Pastikan gambar tidak blur, tidak editan, bukan uang mainan, bukan mata uang asing.
4. Bandingkan dengan jumlah input.
5. Berikan keputusan akhir.

====================================================
PROSES ANALISIS WAJIB
====================================================

A. ANALISIS OBJEK
- Apakah objek terlihat seperti uang kertas?
- Apakah terdapat tulisan "Bank Indonesia"?
- Apakah terdapat angka nominal besar?
- Apakah warna sesuai standar:
  1000 = abu
  2000 = abu hijau
  5000 = coklat
  10000 = ungu
  20000 = hijau
  50000 = biru
  100000 = merah

B. ANALISIS KEJELASAN
- Apakah gambar tajam?
- Apakah nominal terbaca jelas?
- Apakah pencahayaan cukup?

C. ANALISIS KEASLIAN
- Apakah ini foto asli bukan screenshot?
- Apakah ada indikasi manipulasi digital?
- Apakah terlihat seperti uang mainan?

D. EKSTRAK NOMINAL
- Tentukan nominal pasti (1000–100000).
- Jika ragu >10% → anggap tidak valid.

E. VALIDASI INPUT
- Cocokkan nominal dengan ${amount}.
- Harus cocok PERSIS untuk diterima.

====================================================
ATURAN KEPUTUSAN
====================================================

Jika:
- Bukan uang → REJECTED_NOT_MONEY
- Uang blur → REJECTED_UNCLEAR_IMAGE
- Nominal beda → REJECTED_AMOUNT_MISMATCH
- Nominal cocok → ACCEPTED

====================================================
OUTPUT WAJIB JSON SAJA
====================================================

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
`;

    // Panggil Gemini API (ganti key dengan environment variable)
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyAflR8KzpM6CCfDje7Osb3cuq3m3EQPGAU';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: image.replace(/^data:image\/\w+;base64,/, '')
                  }
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;

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

    const result = JSON.parse(cleaned);

    // Jika diterima, update saldo dan simpan history
    if (
      result.final_decision?.status === 'ACCEPTED' &&
      result.analysis?.confidence_level >= 85
    ) {
      const updated = updateBalance(userId, amount, {
        amount,
        status: result.final_decision.status,
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

    // Jika ditolak, tetap catat penolakan di history? Boleh dicatat sebagai rejected
    // Agar user tahu riwayat penolakan, kita simpan juga
    createUserIfNotExists(userId);
    updateBalance(userId, 0, {
      amount: 0,
      status: result.final_decision?.status || 'REJECTED',
      confidence: result.analysis?.confidence_level || 0,
      reason: result.final_decision?.reason || 'Ditolak AI',
      date: new Date().toISOString()
    });

    // Ambil user terbaru untuk dikirim balik (agar history ter-update)
    const user = getUser(userId);
    return res.status(200).json({
      ...result,
      total: user.balance,
      history: user.history
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error', detail: error.message });
  }
}