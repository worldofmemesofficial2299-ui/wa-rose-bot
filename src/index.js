import 'dotenv/config';
import express from 'express';
import { connectDB } from './db.js';
import { startTelegram } from './telegram.js';
import { initializeWhatsApp } from './whatsapp.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.status(200).send('WA Rose Bot is running'));

app.listen(PORT, () => console.log(`🌐 Web server on port ${PORT}`));

async function main() {
  await connectDB(process.env.MONGODB_URI);
  const ownerChatId = parseInt(process.env.TELEGRAM_OWNER_ID);
  const telegramBot = startTelegram(process.env.TELEGRAM_BOT_TOKEN, ownerChatId);

  // 🔥 CRITICAL: Do NOT await this. It must run in the background.
  initializeWhatsApp(telegramBot, ownerChatId, true).catch(console.error);
}

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));

main().catch(console.error);
