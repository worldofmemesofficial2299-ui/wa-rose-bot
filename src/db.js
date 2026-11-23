import { MongoClient } from 'mongodb';

let client, db;

export async function connectDB(uri) {
  // Add the options object here
  client = new MongoClient(uri, {
    autoSelectFamily: false,
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
  return doc ? JSON.parse(doc.data) : null;
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

export async function clearSession() {
  await db.collection('session').deleteOne({ _id: 'creds' });
  console.log('Session cleared from database');
    }
