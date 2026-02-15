// ==================== KONFIGURASI ====================
const TARGET = 5000000;
let userId = localStorage.getItem('tabungan_userId');
if (!userId) {
  userId = 'user_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('tabungan_userId', userId);
}

// Elemen DOM
const totalEl = document.querySelector('.total-amount');
const percentageEl = document.querySelector('.percentage');
const progressFill = document.querySelector('.progress-fill');
const amountInput = document.getElementById('amountInput');
const fileInput = document.getElementById('fileInput');
const previewDiv = document.getElementById('preview');
const simpanBtn = document.getElementById('simpanBtn');
const riwayatList = document.getElementById('riwayatList');
const hapusRiwayatBtn = document.getElementById('hapusRiwayatBtn');
const nabungBtn = document.getElementById('nabungBtn');
const tarikBtn = document.getElementById('tarikBtn');
const loadingModal = document.getElementById('loadingModal');
const loadingMessage = document.getElementById('loadingMessage');

// State
let currentBalance = 0;

// ==================== HELPER ====================
function formatRupiah(angka) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);
}

function updateTotalUI() {
  totalEl.textContent = formatRupiah(currentBalance);
  const persen = Math.min((currentBalance / TARGET) * 100, 100);
  percentageEl.textContent = `${Math.floor(persen)}%`;
  progressFill.style.width = `${persen}%`;
}

// Render riwayat dari data server
function renderRiwayat(history = []) {
  if (!history || history.length === 0) {
    riwayatList.innerHTML = '<div class="empty-state">Belum ada transaksi</div>';
    return;
  }

  let html = '';
  history.slice().reverse().forEach(t => {
    let statusClass = '';
    let statusText = '';
    if (t.status === 'ACCEPTED') {
      statusClass = 'accepted';
      statusText = '✓ Diterima';
    } else if (t.status === 'WITHDRAW') {
      statusClass = 'withdraw';
      statusText = '↑ Tarik';
    } else {
      statusClass = 'rejected';
      statusText = '✗ Ditolak';
    }

    const nominal = Math.abs(t.amount);
    const date = new Date(t.date).toLocaleString('id-ID');

    html += `
      <div class="transaksi-item ${statusClass}">
        <div class="transaksi-info">
          <div class="nominal">${formatRupiah(nominal)}</div>
          <div class="meta">${date}</div>
        </div>
        <div class="transaksi-status">
          <div class="status-badge">${statusText}</div>
          ${t.confidence ? `<div class="confidence">AI ${t.confidence}%</div>` : ''}
          ${t.reason ? `<div class="confidence" style="color:#ffb0b0;">${t.reason.substring(0,30)}...</div>` : ''}
        </div>
      </div>
    `;
  });
  riwayatList.innerHTML = html;
}

// ==================== AMBIL DATA USER DARI SERVER ====================
async function loadUserData() {
  try {
    const res = await fetch(`/api/check?userId=${userId}`);
    if (!res.ok) throw new Error('Gagal mengambil data');
    const user = await res.json();
    currentBalance = user.balance || 0;
    updateTotalUI();
    renderRiwayat(user.history);
  } catch (err) {
    console.error(err);
  }
}

// ==================== MODAL LOADING ====================
const loadingTexts = [
  'AI sedang mendeteksi objek...',
  'Menganalisis warna dan nominal...',
  'Memeriksa keaslian uang...',
  'Membandingkan dengan input...',
  'Menentukan keputusan akhir...'
];
let textInterval = null;

function startLoadingAnimation() {
  let index = 0;
  loadingMessage.textContent = loadingTexts[0];
  textInterval = setInterval(() => {
    index = (index + 1) % loadingTexts.length;
    loadingMessage.textContent = loadingTexts[index];
  }, 1500);
}

function stopLoadingAnimation() {
  if (textInterval) {
    clearInterval(textInterval);
    textInterval = null;
  }
}

function showModal() {
  loadingModal.classList.add('show');
  startLoadingAnimation();
  simpanBtn.disabled = true;
}

function hideModal() {
  loadingModal.classList.remove('show');
  stopLoadingAnimation();
  simpanBtn.disabled = false;
}

// ==================== PREVIEW FOTO ====================
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) {
    previewDiv.innerHTML = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = document.createElement('img');
    img.src = ev.target.result;
    previewDiv.innerHTML = '';
    previewDiv.appendChild(img);
  };
  reader.readAsDataURL(file);
});

// ==================== SETOR TUNAI (DENGAN AI) ====================
async function handleSimpan() {
  const amount = parseInt(amountInput.value);
  const file = fileInput.files[0];

  if (!amount || amount < 1000) {
    alert('Masukkan nominal tabungan minimal Rp 1.000');
    return;
  }
  if (!file) {
    alert('Ambil foto uang terlebih dahulu');
    return;
  }

  // Konversi ke base64
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  showModal();

  try {
    const response = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'deposit',
        userId,
        amount,
        image: base64
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Server error');
    }

    // Jika transaksi diterima, result akan mengandung total dan history terbaru
    if (result.final_decision?.status === 'ACCEPTED' && result.analysis?.confidence_level >= 85) {
      currentBalance = result.total;
      renderRiwayat(result.history);
      updateTotalUI();
      alert(`✅ Tabungan diterima! Saldo bertambah ${formatRupiah(amount)}`);
    } else if (result.final_decision) {
      // Ditolak AI
      alert(`❌ Gagal: ${result.final_decision.reason}`);
    } else if (result.total !== undefined) {
      // Kasus withdraw atau lainnya
      currentBalance = result.total;
      renderRiwayat(result.history);
      updateTotalUI();
    } else {
      alert('Respon tidak dikenal');
    }

    // Reset form
    amountInput.value = '';
    fileInput.value = '';
    previewDiv.innerHTML = '';

  } catch (error) {
    console.error(error);
    alert('Terjadi kesalahan: ' + error.message);
  } finally {
    hideModal();
  }
}

// ==================== TARIK TUNAI (TANPA AI) ====================
async function handleTarik() {
  const amountPrompt = prompt('Masukkan nominal penarikan:', '');
  if (!amountPrompt) return;

  const amount = parseInt(amountPrompt);
  if (isNaN(amount) || amount <= 0) {
    alert('Nominal tidak valid');
    return;
  }

  showModal(); // pakai modal loading sebagai indikator proses

  try {
    const response = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'withdraw',
        userId,
        amount
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Server error');
    }

    if (result.total !== undefined) {
      currentBalance = result.total;
      renderRiwayat(result.history);
      updateTotalUI();
      alert(`✅ Penarikan ${formatRupiah(amount)} berhasil`);
    } else {
      alert('Respon tidak dikenal');
    }

  } catch (error) {
    console.error(error);
    alert('Gagal: ' + error.message);
  } finally {
    hideModal();
  }
}

// ==================== HAPUS RIWAYAT (SERVE SIDE) ====================
async function hapusRiwayat() {
  if (!confirm('Hapus semua riwayat transaksi? Data tidak dapat dikembalikan.')) return;

  // Kita bisa buat endpoint khusus untuk hapus riwayat, tapi sederhananya kita kirim type: 'clear_history'
  // Untuk memudahkan, kita buat request POST dengan type 'clear'
  try {
    const response = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clear', userId })
    });

    if (!response.ok) throw new Error('Gagal menghapus');

    const result = await response.json();
    currentBalance = result.balance;
    renderRiwayat(result.history);
    updateTotalUI();
    alert('Riwayat dihapus');
  } catch (err) {
    alert(err.message);
  }
}

// ==================== EVENT LISTENERS ====================
simpanBtn.addEventListener('click', handleSimpan);
tarikBtn.addEventListener('click', handleTarik);
hapusRiwayatBtn.addEventListener('click', hapusRiwayat);
nabungBtn.addEventListener('click', () => {
  document.getElementById('formNabung').scrollIntoView({ behavior: 'smooth' });
});

// ==================== INISIALISASI ====================
loadUserData();