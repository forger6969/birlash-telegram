// server.js
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const bodyParser = require('body-parser');
const cors = require("cors");


// Настройки из .env
const BOT_TOKEN = process.env.BOT_TOKEN;
const API_PORT = process.env.API_PORT || 3000;
const API_SECRET_KEY = process.env.API_SECRET_KEY;
const ADMIN_ID = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim()));
const PAYMENT_PASSWORD = process.env.PAYMENT_PASSWORD;

// Проверка обязательных переменных
if (!BOT_TOKEN || !API_SECRET_KEY || !ADMIN_ID || !PAYMENT_PASSWORD) {
  console.error('❌ Ошибка: Проверьте файл .env! Не все переменные заданы.');
  process.exit(1);
}

// Инициализация Express и Telegram бота
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(cors());

// База данных
const clients = [];
const subscribers = new Set();

// Цены пакетов
const PACKAGES = {
  'ASOS': {
    price: 50000,
    name: '🟢 ASOS',
    title: 'Базовый пакет',
    description: '✨ Идеально для начинающих\n\n📦 Что входит:\n• Функция 1\n• Функция 2\n• Функция 3\n• Поддержка 24/7',
    emoji: '🟢'
  },
  "O'SISH": {
    price: 100000,
    name: "🟡 O'SISH",
    title: 'Стандартный пакет',
    description: '⭐ Оптимальный выбор\n\n📦 Что входит:\n• Всё из ASOS\n• Расширенные функции\n• Приоритетная поддержка\n• Бонусы',
    emoji: '🟡'
  },
  "TA'SIR": {
    price: 200000,
    name: "🔴 TA'SIR",
    title: 'Премиум пакет',
    description: '💎 Максимум возможностей\n\n📦 Что входит:\n• Всё из O\'SISH\n• VIP функции\n• Персональный менеджер\n• Эксклюзивный контент\n• Максимальная скорость',
    emoji: '🔴'
  }
};

// Состояние пользователей для навигации
const userStates = {};
const pendingPaymentConfirmations = {}; // Ожидающие подтверждения оплаты
const pendingNotifications = {}; // Ожидающие отправки уведомления

// Форматирование числа с пробелами
const formatNumber = (num) => num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// Форматирование даты
const formatDate = (date) => {
  const d = new Date(date);
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
};

// Проверка админа
const isAdmin = (chatId) => ADMIN_ID.includes(chatId);

// ==================== TELEGRAM BOT - ОБЫЧНЫЕ ПОЛЬЗОВАТЕЛИ ====================

// Команда /start для обычных пользователей
function sendUserStartMessage(chatId, userName) {
  subscribers.add(chatId);

  const message = `Привет, ${userName}! 👋\n\n` +
    `🎯 *Выберите подходящий пакет*\n\n` +
    `У нас есть три варианта на любой вкус:\n\n` +
    `${PACKAGES.ASOS.emoji} *ASOS* - ${formatNumber(PACKAGES.ASOS.price)} сум\n` +
    `   ${PACKAGES.ASOS.title}\n\n` +
    `${PACKAGES["O'SISH"].emoji} *O'SISH* - ${formatNumber(PACKAGES["O'SISH"].price)} сум\n` +
    `   ${PACKAGES["O'SISH"].title}\n\n` +
    `${PACKAGES["TA'SIR"].emoji} *TA'SIR* - ${formatNumber(PACKAGES["TA'SIR"].price)} сум\n` +
    `   ${PACKAGES["TA'SIR"].title}\n\n` +
    `👇 Нажмите на кнопку, чтобы узнать подробности`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🟢 ASOS', callback_data: 'package_ASOS' }
      ],
      [
        { text: "🟡 O'SISH", callback_data: 'package_O\'SISH' }
      ],
      [
        { text: "🔴 TA'SIR", callback_data: 'package_TA\'SIR' }
      ]
    ]
  };

  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// Показать информацию о пакете
function showPackageInfo(chatId, packageName) {
  const pkg = PACKAGES[packageName];

  if (!pkg) return;

  const message = `${pkg.emoji} *${pkg.name}*\n\n` +
    `💰 *Цена: ${formatNumber(pkg.price)} сум*\n\n` +
    `${pkg.description}\n\n` +
    `📞 Для заказа свяжитесь с нами или оставьте заявку на сайте!`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '◀️ Назад к пакетам', callback_data: 'back_to_packages' }
      ],
      [
        { text: '📞 Связаться', url: 'https://t.me/forgerjunior' }
      ]
    ]
  };

  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ==================== TELEGRAM BOT - АДМИН ====================

// Команда /start для админа
function sendAdminStartMessage(chatId, userName) {
  const message = `Привет, ${userName}! 👋\n\n` +
    `🔐 *Админ-панель*\n\n` +
    `📋 *Команды управления:*\n` +
    `/all - Все клиенты\n` +
    `/stats - Статистика и доходы\n` +
    `/pending - Ожидают оплаты\n` +
    `/clients - Купившие клиенты\n` +
    `/notify - Отправить уведомление\n` +
    `/password - Изменить пароль оплаты\n\n` +
    `📊 *Доступные пакеты:*\n` +
    `🟢 ASOS - ${formatNumber(PACKAGES.ASOS.price)} сум\n` +
    `🟡 O'SISH - ${formatNumber(PACKAGES["O'SISH"].price)} сум\n` +
    `🔴 TA'SIR - ${formatNumber(PACKAGES["TA'SIR"].price)} сум\n\n` +
    `📈 Всего клиентов: *${clients.length}*\n` +
    `✅ Оплатили: *${clients.filter(c => c.status === 'paid').length}*\n` +
    `⏳ Ожидают: *${clients.filter(c => c.status === 'pending').length}*`;

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

// ==================== TELEGRAM BOT COMMANDS ====================

// Команда /start - разная для админа и пользователя
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name;

  if (isAdmin(chatId)) {
    sendAdminStartMessage(chatId, userName);
  } else {
    sendUserStartMessage(chatId, userName);
  }
});

// Команда /all - показать всех клиентов с навигацией (ТОЛЬКО ДЛЯ АДМИНА)
bot.onText(/\/all/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAdmin(chatId)) {
    return bot.sendMessage(chatId, '❌ У вас нет доступа к этой команде');
  }

  if (clients.length === 0) {
    return bot.sendMessage(chatId, '📭 Клиентов пока нет');
  }

  userStates[chatId] = { currentIndex: 0, viewing: 'all' };
  showClient(chatId, 0, 'all');
});

// Команда /pending - клиенты ожидающие оплаты (ТОЛЬКО ДЛЯ АДМИНА)
bot.onText(/\/pending/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAdmin(chatId)) {
    return bot.sendMessage(chatId, '❌ У вас нет доступа к этой команде');
  }

  const pendingClients = clients.filter(c => c.status === 'pending');

  if (pendingClients.length === 0) {
    return bot.sendMessage(chatId, '✅ Нет клиентов ожидающих оплаты');
  }

  userStates[chatId] = { currentIndex: 0, viewing: 'pending', filteredClients: pendingClients };
  showClient(chatId, 0, 'pending');
});

// Команда /clients - купившие клиенты (ТОЛЬКО ДЛЯ АДМИНА)
bot.onText(/\/clients/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAdmin(chatId)) {
    return bot.sendMessage(chatId, '❌ У вас нет доступа к этой команде');
  }

  const paidClients = clients.filter(c => c.status === 'paid');

  if (paidClients.length === 0) {
    return bot.sendMessage(chatId, '📭 Нет купивших клиентов');
  }

  userStates[chatId] = { currentIndex: 0, viewing: 'clients', filteredClients: paidClients };
  showClient(chatId, 0, 'clients');
});

// Команда /stats - статистика (ТОЛЬКО ДЛЯ АДМИНА)
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAdmin(chatId)) {
    return bot.sendMessage(chatId, '❌ У вас нет доступа к этой команде');
  }

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const totalClients = clients.length;
  const paidClients = clients.filter(c => c.status === 'paid');
  const pendingClients = clients.filter(c => c.status === 'pending');

  const totalRevenue = paidClients.reduce((sum, client) => sum + client.paketPrice, 0);

  const monthRevenue = paidClients
    .filter(c => {
      const date = new Date(c.paidDate || c.createdAt);
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    })
    .reduce((sum, client) => sum + client.paketPrice, 0);

  const packageStats = {};
  Object.keys(PACKAGES).forEach(pkg => {
    const count = paidClients.filter(c => c.selectedPaket === pkg).length;
    const revenue = paidClients
      .filter(c => c.selectedPaket === pkg)
      .reduce((sum, client) => sum + client.paketPrice, 0);
    packageStats[pkg] = { count, revenue };
  });

  let message = `📊 *СТАТИСТИКА*\n\n`;
  message += `👥 *Всего клиентов:* ${totalClients}\n`;
  message += `✅ *Купили:* ${paidClients.length}\n`;
  message += `⏳ *Ожидают:* ${pendingClients.length}\n\n`;

  message += `💰 *ДОХОДЫ*\n`;
  message += `📅 За текущий месяц: *${formatNumber(monthRevenue)} сум*\n`;
  message += `💎 За все время: *${formatNumber(totalRevenue)} сум*\n\n`;

  message += `📦 *ПО ПАКЕТАМ*\n`;
  Object.keys(PACKAGES).forEach(pkg => {
    const stats = packageStats[pkg];
    if (stats.count > 0) {
      message += `${PACKAGES[pkg].emoji} ${PACKAGES[pkg].name}\n`;
      message += `   Продано: ${stats.count} шт.\n`;
      message += `   Доход: ${formatNumber(stats.revenue)} сум\n\n`;
    }
  });

  const topClients = paidClients
    .sort((a, b) => b.paketPrice - a.paketPrice)
    .slice(0, 3);

  if (topClients.length > 0) {
    message += `🏆 *ТОП КЛИЕНТЫ*\n`;
    topClients.forEach((client, i) => {
      message += `${i + 1}. ${client.firstName} - ${formatNumber(client.paketPrice)} сум\n`;
    });
  }

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Команда /notify - отправить уведомление (ТОЛЬКО ДЛЯ АДМИНА)
bot.onText(/\/notify/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAdmin(chatId)) {
    return bot.sendMessage(chatId, '❌ У вас нет доступа к этой команде');
  }

  if (subscribers.size === 0) {
    return bot.sendMessage(chatId, '📭 Нет подписчиков для отправки уведомлений');
  }

  pendingNotifications[chatId] = { step: 'text' };

  bot.sendMessage(chatId,
    `📢 *Отправка уведомления*\n\n` +
    `👥 Подписчиков: ${subscribers.size}\n\n` +
    `📝 Отправьте текст сообщения, которое хотите разослать:\n\n` +
    `_Можно использовать Markdown форматирование_\n` +
    `_Для отмены отправьте /cancel_`,
    { parse_mode: 'Markdown' }
  );
});

// Функция показа клиента с кнопками навигации (ТОЛЬКО ДЛЯ АДМИНА)
function showClient(chatId, index, viewType) {
  const state = userStates[chatId];
  let clientsList = viewType === 'all' ? clients : state.filteredClients;

  if (index < 0 || index >= clientsList.length) return;

  const client = clientsList[index];
  const statusEmoji = client.status === 'paid' ? '✅' : '⏳';
  const statusText = client.status === 'paid' ? 'Оплачено' : 'Ожидает оплаты';

  let message = `${statusEmoji} *Клиент ${index + 1} из ${clientsList.length}*\n\n`;
  message += `👤 *Имя:* ${client.firstName}\n`;
  message += `📱 *Телефон:* ${client.number}\n`;
  message += `📦 *Пакет:* ${PACKAGES[client.selectedPaket].name}\n`;
  message += `💰 *Цена:* ${formatNumber(client.paketPrice)} сум\n`;
  message += `📊 *Статус:* ${statusText}\n`;
  message += `📅 *Дата:* ${formatDate(client.createdAt)}`;

  if (client.status === 'paid' && client.paidDate) {
    message += `\n💳 *Оплачено:* ${formatDate(client.paidDate)}`;
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: '⬅️', callback_data: `nav_prev_${viewType}` },
        { text: `${index + 1}/${clientsList.length}`, callback_data: 'nav_ignore' },
        { text: '➡️', callback_data: `nav_next_${viewType}` }
      ],
      [{ text: '📋 Подробно', callback_data: `details_${client.id}` }]
    ]
  };

  // Если клиент ожидает оплаты, добавляем кнопку подтверждения
  if (client.status === 'pending') {
    keyboard.inline_keyboard.push([
      { text: '✅ Подтвердить оплату', callback_data: `confirm_${client.id}` }
    ]);
  }

  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// Обработка текстовых сообщений (для ввода пароля и уведомлений)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Пропускаем обработку команд (они обрабатываются отдельно)
  if (text && text.startsWith('/') && text !== '/cancel') {
    return;
  }

  // Обработка фото для уведомления (ПРИОРИТЕТ!)
  if (msg.photo && pendingNotifications[chatId] && isAdmin(chatId)) {
    const notification = pendingNotifications[chatId];

    if (notification.step === 'image') {
      const photo = msg.photo[msg.photo.length - 1]; // Берем самое большое фото
      notification.imageFileId = photo.file_id;

      // Отправляем уведомление
      await sendNotificationToSubscribers(chatId, notification.text, notification.imageFileId);
      delete pendingNotifications[chatId];
    }

    return;
  }

  // Команда отмены
  if (text === '/cancel') {
    if (pendingPaymentConfirmations[chatId]) {
      delete pendingPaymentConfirmations[chatId];
      return bot.sendMessage(chatId, '❌ Подтверждение оплаты отменено');
    }
    if (pendingNotifications[chatId]) {
      delete pendingNotifications[chatId];
      return bot.sendMessage(chatId, '❌ Отправка уведомления отменена');
    }
  }

  // Обработка уведомлений (ТОЛЬКО ДЛЯ АДМИНА)
  if (pendingNotifications[chatId] && isAdmin(chatId) && text) {
    const notification = pendingNotifications[chatId];

    // Шаг 1: Получение текста
    if (notification.step === 'text') {
      notification.text = text;
      notification.step = 'image';

      const keyboard = {
        inline_keyboard: [
          [{ text: '📤 Отправить без картинки', callback_data: 'send_notification_no_image' }],
          [{ text: '❌ Отмена', callback_data: 'cancel_notification' }]
        ]
      };

      return bot.sendMessage(chatId,
        `✅ *Текст получен!*\n\n` +
        `📸 Теперь отправьте *картинку* или нажмите кнопку ниже, чтобы отправить без картинки:\n\n` +
        `_Для отмены нажмите "Отмена"_`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
    }

    return;
  }

  // Проверяем, ожидается ли ввод пароля
  if (pendingPaymentConfirmations[chatId] && text) {
    const { clientId, messageId } = pendingPaymentConfirmations[chatId];

    // Проверяем пароль
    if (text === PAYMENT_PASSWORD) {
      const client = clients.find(c => c.id === clientId);

      if (client) {
        client.status = 'paid';
        client.paidDate = new Date();

        bot.sendMessage(chatId, `✅ *Оплата подтверждена!*\n\nКлиент: ${client.firstName}\nСумма: ${formatNumber(client.paketPrice)} сум`, {
          parse_mode: 'Markdown'
        });

        // Обновляем отображение клиента
        const state = userStates[chatId];
        if (state) {
          showClient(chatId, state.currentIndex, state.viewing);
        }
      }
    } else {
      bot.sendMessage(chatId, '❌ *Неверный пароль!*\n\nОплата не подтверждена. Попробуйте снова.', {
        parse_mode: 'Markdown'
      });
    }

    // Очищаем состояние ожидания
    delete pendingPaymentConfirmations[chatId];
  }
});

// Функция отправки уведомления всем подписчикам
async function sendNotificationToSubscribers(adminChatId, text, imageFileId = null) {
  let sent = 0;
  let failed = 0;

  bot.sendMessage(adminChatId, '⏳ Отправка уведомлений...');

  for (const chatId of subscribers) {
    try {
      if (imageFileId) {
        await bot.sendPhoto(chatId, imageFileId, {
          caption: text,
          parse_mode: 'Markdown'
        });
      } else {
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      }
      sent++;
    } catch (error) {
      console.error(`Ошибка отправки ${chatId}:`, error.message);
      failed++;
    }
  }

  bot.sendMessage(adminChatId,
    `✅ *Уведомление отправлено!*\n\n` +
    `📤 Успешно: ${sent}\n` +
    `❌ Ошибок: ${failed}\n` +
    `👥 Всего подписчиков: ${subscribers.size}`,
    { parse_mode: 'Markdown' }
  );
}

// Обработка callback кнопок
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const messageId = query.message.message_id;

  // ========== ОБРАБОТКА ДЛЯ ОБЫЧНЫХ ПОЛЬЗОВАТЕЛЕЙ ==========

  if (data.startsWith('package_')) {
    const packageName = data.replace('package_', '');
    bot.answerCallbackQuery(query.id);
    showPackageInfo(chatId, packageName);
    return;
  }

  if (data === 'back_to_packages') {
    bot.answerCallbackQuery(query.id);
    bot.deleteMessage(chatId, messageId);
    sendUserStartMessage(chatId, query.from.first_name);
    return;
  }

  // ========== ОБРАБОТКА ДЛЯ АДМИНА ==========

  if (!isAdmin(chatId)) {
    return bot.answerCallbackQuery(query.id, { text: '❌ Нет доступа' });
  }

  // Навигация по клиентам
  if (data.startsWith('nav_')) {
    const [, action, viewType] = data.split('_');
    const state = userStates[chatId];

    if (action === 'ignore') {
      return bot.answerCallbackQuery(query.id);
    }

    let newIndex = state.currentIndex;
    const clientsList = viewType === 'all' ? clients : state.filteredClients;

    if (action === 'next') {
      newIndex = (state.currentIndex + 1) % clientsList.length;
    } else if (action === 'prev') {
      newIndex = (state.currentIndex - 1 + clientsList.length) % clientsList.length;
    }

    state.currentIndex = newIndex;

    bot.deleteMessage(chatId, messageId);
    showClient(chatId, newIndex, viewType);
    bot.answerCallbackQuery(query.id);
  }

  // Подробности о клиенте
  if (data.startsWith('details_')) {
    const clientId = data.split('_')[1];
    const client = clients.find(c => c.id === clientId);

    if (!client) {
      return bot.answerCallbackQuery(query.id, { text: '❌ Клиент не найден' });
    }

    let details = `📋 *ПОДРОБНАЯ ИНФОРМАЦИЯ*\n\n`;
    details += `🆔 *ID:* ${client.id}\n`;
    details += `👤 *Имя:* ${client.firstName}\n`;
    details += `📱 *Телефон:* ${client.number}\n`;
    details += `📦 *Выбранный пакет:* ${PACKAGES[client.selectedPaket].name}\n`;
    details += `💰 *Стоимость:* ${formatNumber(client.paketPrice)} сум\n`;
    details += `📊 *Статус:* ${client.status === 'paid' ? '✅ Оплачено' : '⏳ Ожидает оплаты'}\n`;
    details += `📅 *Дата создания:* ${formatDate(client.createdAt)}\n`;

    if (client.status === 'paid' && client.paidDate) {
      details += `💳 *Дата оплаты:* ${formatDate(client.paidDate)}\n`;
    }

    if (client.comment) {
      details += `\n💬 *Комментарий:* ${client.comment}`;
    }

    bot.sendMessage(chatId, details, { parse_mode: 'Markdown' });
    bot.answerCallbackQuery(query.id);
  }

  // Запрос на подтверждение оплаты
  if (data.startsWith('confirm_')) {
    const clientId = data.split('_')[1];
    const client = clients.find(c => c.id === clientId);

    if (!client) {
      return bot.answerCallbackQuery(query.id, { text: '❌ Клиент не найден' });
    }

    // Сохраняем информацию о pending confirmation
    pendingPaymentConfirmations[chatId] = { clientId, messageId };

    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, `🔐 *Введите пароль для подтверждения оплаты*\n\nКлиент: ${client.firstName}\nСумма: ${formatNumber(client.paketPrice)} сум`, {
      parse_mode: 'Markdown'
    });
  }

  // Отправка уведомления без картинки
  if (data === 'send_notification_no_image') {
    const notification = pendingNotifications[chatId];

    if (notification && notification.text) {
      bot.answerCallbackQuery(query.id);
      bot.deleteMessage(chatId, messageId);
      await sendNotificationToSubscribers(chatId, notification.text);
      delete pendingNotifications[chatId];
    }
  }

  // Отмена отправки уведомления
  if (data === 'cancel_notification') {
    delete pendingNotifications[chatId];
    bot.answerCallbackQuery(query.id, { text: '❌ Отправка отменена' });
    bot.deleteMessage(chatId, messageId);
  }
});

// Обработка ошибок бота
bot.on('polling_error', (error) => {
  console.error('Ошибка polling:', error);
});

// ==================== API ENDPOINTS ====================

const checkApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (apiKey !== API_SECRET_KEY) {
    return res.status(401).json({ success: false, error: 'Неверный API ключ' });
  }
  next();
};

app.get('/', (req, res) => {
  res.json({
    message: 'CRM Telegram Bot API',
    version: '2.0.0',
    endpoints: {
      'POST /api/client': 'Добавить нового клиента',
      'GET /api/clients': 'Получить всех клиентов',
      'GET /api/stats': 'Получить статистику',
      'PUT /api/client/:id': 'Изменить статус клиента',
      'POST /api/notify': 'Отправить уведомление подписчикам'
    }
  });
});

app.post('/api/client', checkApiKey, async (req, res) => {
  try {
    const { firstName, number, selectedPaket, comment } = req.body;

    if (!firstName || !number || !selectedPaket) {
      return res.status(400).json({
        success: false,
        error: 'Необходимы поля: firstName, number, selectedPaket'
      });
    }

    if (!PACKAGES[selectedPaket]) {
      return res.status(400).json({
        success: false,
        error: 'Неверный пакет. Доступные: ASOS, O\'SISH, TA\'SIR'
      });
    }

    const client = {
      id: Date.now().toString(),
      firstName,
      number,
      status: 'pending',
      selectedPaket,
      paketPrice: PACKAGES[selectedPaket].price,
      createdAt: new Date(),
      comment: comment || null,
      paidDate: null
    };

    clients.push(client);

    if (ADMIN_ID) {
      const message = `🔔 *НОВЫЙ КЛИЕНТ!*\n\n` +
        `👤 ${client.firstName}\n` +
        `📱 ${client.number}\n` +
        `📦 ${PACKAGES[client.selectedPaket].name}\n` +
        `💰 ${formatNumber(client.paketPrice)} сум\n\n` +
        `Используйте /all для просмотра`;

      bot.sendMessage(ADMIN_ID, message, { parse_mode: 'Markdown' });
    }

    res.json({
      success: true,
      message: 'Клиент добавлен',
      client: client
    });

  } catch (error) {
    console.error('Ошибка при добавлении клиента:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/clients', checkApiKey, (req, res) => {
  const { status } = req.query;

  let filteredClients = clients;

  if (status) {
    filteredClients = clients.filter(c => c.status === status);
  }

  res.json({
    success: true,
    count: filteredClients.length,
    clients: filteredClients
  });
});

app.get('/api/stats', checkApiKey, (req, res) => {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const paidClients = clients.filter(c => c.status === 'paid');
  const totalRevenue = paidClients.reduce((sum, c) => sum + c.paketPrice, 0);

  const monthRevenue = paidClients
    .filter(c => {
      const date = new Date(c.paidDate || c.createdAt);
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    })
    .reduce((sum, c) => sum + c.paketPrice, 0);

  res.json({
    success: true,
    stats: {
      totalClients: clients.length,
      paidClients: paidClients.length,
      pendingClients: clients.filter(c => c.status === 'pending').length,
      totalRevenue,
      monthRevenue
    }
  });
});

app.put('/api/client/:id', checkApiKey, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const client = clients.find(c => c.id === id);

  if (!client) {
    return res.status(404).json({ success: false, error: 'Клиент не найден' });
  }

  if (status && ['pending', 'paid'].includes(status)) {
    client.status = status;
    if (status === 'paid') {
      client.paidDate = new Date();
    }
  }

  res.json({
    success: true,
    message: 'Статус обновлен',
    client
  });
});

app.post('/api/notify', checkApiKey, async (req, res) => {
  try {
    const { text, image } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, error: 'Необходим текст' });
    }

    let sent = 0;

    for (const chatId of subscribers) {
      try {
        if (image) {
          await bot.sendPhoto(chatId, image, { caption: text, parse_mode: 'Markdown' });
        } else {
          await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        }
        sent++;
      } catch (error) {
        console.error(`Ошибка отправки ${chatId}:`, error.message);
      }
    }

    res.json({ success: true, sent });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(API_PORT, () => {
  console.log(`✅ CRM Бот запущен на порту ${API_PORT}`);
  console.log(`✅ Admin ID: ${ADMIN_ID}`);
  console.log(`🔐 Пароль для оплаты: ${PAYMENT_PASSWORD}`);
  console.log(`📦 Доступные пакеты:`);
  Object.keys(PACKAGES).forEach(key => {
    console.log(`   ${PACKAGES[key].name} - ${formatNumber(PACKAGES[key].price)} сум`);
  });
});