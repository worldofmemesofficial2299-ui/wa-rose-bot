import { MongoClient } from 'mongodb';

let client, db;

export async function connectDB(uri) {
  client = new MongoClient(uri, {
    autoSelectFamily: false, // Fixes the TLS/SSL Render error
  });
  await client.connect();
  db = client.db('wa-rose-bot');
  console.log('✅ MongoDB connected');
}

export async function saveSession(authState) {
  const data = JSON.stringify(authState.creds);
  await db.collection('session').updateOne(
    { _id: 'creds' },
    { $set: { data, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function loadSession() {
  const doc = await db.collection('session').findOne({ _id: 'creds' });
  if (!doc || !doc.data) return null;
  try {
    // Safety check: Ensure the saved data actually parses
    return JSON.parse(doc.data);
  } catch (e) {
    console.error("Corrupt session found in DB, wiping it.");
    await clearSession();
    return null;
  }
}

export async function clearSession() {
  await db.collection('session').deleteOne({ _id: 'creds' });
  // Also wipe local auth files
  const fs = await import('fs');
  if (fs.existsSync('./auth_info')) {
    fs.rmSync('./auth_info', { recursive: true, force: true });
  }
  console.log('🗑️ Session cleared from database and local disk');
}

export async function getConfig() {
  const doc = await db.collection('config').findOne({ _id: 'main' });
  return doc?.value || null;
}

export async function setConfig(config) {
  await db.collection('config').updateOne(
    { _id: 'main' },
    { $set: { value: config, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function incrementWarn(groupJid, userJid) {
  const key = `${groupJid}:${userJid}`;
  const res = await db.collection('warnings').findOneAndUpdate(
    { _id: key },
    { $inc: { count: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return res.value?.count || 1;
}

export async function resetWarn(groupJid, userJid) {
  await db.collection('warnings').deleteOne({ _id: `${groupJid}:${userJid}` });
}
