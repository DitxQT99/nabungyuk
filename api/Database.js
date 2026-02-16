import fs from 'fs';
import path from 'path';

// Tentukan path data.json (gunakan /tmp jika di Vercel production)
const isVercel = process.env.VERCEL === '1';
const dataDir = isVercel ? '/tmp' : path.join(process.cwd(), 'api');
const dataPath = path.join(dataDir, 'data.json');

// Pastikan folder ada (khusus /tmp tidak perlu)
if (!isVercel && !fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Inisialisasi file jika belum ada
if (!fs.existsSync(dataPath)) {
  fs.writeFileSync(dataPath, JSON.stringify({ users: [] }, null, 2), 'utf8');
}

function readData() {
  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { users: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
}

export function getUser(userId) {
  const data = readData();
  return data.users.find(u => u.id === userId) || null;
}

export function createUserIfNotExists(userId) {
  const data = readData();
  let user = data.users.find(u => u.id === userId);
  if (!user) {
    user = {
      id: userId,
      balance: 0,
      history: []
    };
    data.users.push(user);
    writeData(data);
  }
  return user;
}

export function updateBalance(userId, amount, transaction) {
  const data = readData();
  const user = data.users.find(u => u.id === userId);
  if (!user) throw new Error('User tidak ditemukan');
  user.balance += amount;
  user.history.push(transaction);
  writeData(data);
  return user;
}

export function getAllData() {
  return readData();
}

export function clearHistory(userId) {
  const data = readData();
  const user = data.users.find(u => u.id === userId);
  if (!user) throw new Error('User tidak ditemukan');
  user.history = [];
  writeData(data);
  return user;
}