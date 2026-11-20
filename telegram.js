import { Telegraf } from 'telegraf';
import { getConfig, setConfig } from './db.js';
import { requestQR, requestPairCode, getSock } from './whatsapp.js';
import { defaultConfig } from './config.js';

export function startTelegram(botToken, ownerChatId) {
  const bot = new Telegraf(botToken);

  // Auth guard
  bot.use((ctx, next) => {
    if (ctx.chat?.id !== ownerChatId) {
      return ctx.reply('⛔ Unauthorized.');
    }
    return next();
  });

  bot.start((ctx) => ctx.reply(
    '🤖 *WhatsApp Rose Bot Control Panel*\n\n' +
    '/qr — Get QR code (one-shot)\n' +
    '/pair <phone> — Get pair code\n' +
    '/toggles — Show feature status\n' +
    '/toggle <feature> — Flip on/off\n' +
    '/setwelcome <text> — Update welcome\n' +
    '/setgoodbye <text> — Update goodbye\n' +
    '/setrules <rule1, rule2> — Update rules\n' +
    '/warnlimit <n> — Set warnings before kick\n' +
    '/status — Bot status\n' +
    '/resetwarn <groupId> <userId> — Clear warnings',
    { parse_mode: 'Markdown' }
  ));

  bot.command('qr', (ctx) => requestQR(bot, ownerChatId));
  bot.command('pair', (ctx) => {
    const phone = ctx.message.text.split(' ')[1];
    if (!phone) return ctx.reply('Usage: /pair 2348012345678');
    return requestPairCode(bot, ownerChatId, phone);
  });

  bot.command('toggles', async (ctx) => {
    const config = (await getConfig()) || defaultConfig;
    const lines = Object.entries(config.toggles)
      .map(([k, v]) => `${v ? '✅' : '❌'} ${k}`)
      .join('\n');
    ctx.reply(`*Feature Toggles*\n\n${lines}`, { parse_mode: 'Markdown' });
  });

  bot.command('toggle', async (ctx) => {
    const feature = ctx.message.text.split(' ')[1];
    const config = (await getConfig()) || defaultConfig;
    if (!config.toggles[feature] === undefined) return ctx.reply('Unknown feature.');
    config.toggles[feature] = !config.toggles[feature];
    await setConfig(config);
    ctx.reply(`✅ ${feature} is now ${config.toggles[feature] ? 'ON' : 'OFF'}`);
  });

  bot.command('setwelcome', async (ctx) => {
    const text = ctx.message.text.replace('/setwelcome ', '');
    if (!text) return ctx.reply('Provide text with {tag} placeholder.');
    const config = (await getConfig()) || defaultConfig;
    config.welcomeMessage = text;
    await setConfig(config);
    ctx.reply('✅ Welcome message updated.');
  });

  bot.command('setgoodbye', async (ctx) => {
    const text = ctx.message.text.replace('/setgoodbye ', '');
    if (!text) return ctx.reply('Provide text with {tag} placeholder.');
    const config = (await getConfig()) || defaultConfig;
    config.goodbyeMessage = text;
    await setConfig(config);
    ctx.reply('✅ Goodbye message updated.');
  });

  bot.command('setrules', async (ctx) => {
    const rules = ctx.message.text.replace('/setrules ', '').split(',').map((r) => r.trim());
    if (!rules.length) return ctx.reply('Provide comma-separated rules.');
    const config = (await getConfig()) || defaultConfig;
    config.rules = rules;
    await setConfig(config);
    ctx.reply(`✅ ${rules.length} rules saved.`);
  });

  bot.command('warnlimit', async (ctx) => {
    const n = parseInt(ctx.message.text.split(' ')[1]);
    if (!n || n < 1) return ctx.reply('Provide a number ≥ 1.');
    const config = (await getConfig()) || defaultConfig;
    config.warnLimit = n;
    await setConfig(config);
    ctx.reply(`✅ Warn limit set to ${n}.`);
  });

  bot.command('status', (ctx) => {
    const s = getSock();
    const connected = s?.user ? `✅ Connected as ${s.user.id.split(':')[0]}` : '❌ Not connected';
    ctx.reply(`*Bot Status*\n\nWhatsApp: ${connected}`);
  });

  bot.launch();
  return bot;
        }
