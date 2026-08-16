const { createClient } = require("@supabase/supabase-js");

// service_role key — используем только на сервере (бот/крон), никогда не в браузере.
// Он обходит Row Level Security, поэтому все проверки доступа делаем сами в коде.
//
// NEXT_PUBLIC_SUPABASE_URL, а не SUPABASE_URL — во всём остальном проекте
// (59 мест) используется именно эта переменная. Отдельной SUPABASE_URL (без
// NEXT_PUBLIC_) в проекте больше нигде нет, поэтому если в окружении бота
// задать только «стандартный» набор переменных (как для остального
// приложения), раньше здесь получался createClient(undefined, ключ), и бот
// либо падал при старте, либо молча не работал (см. п. 1.3 аудита).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = { supabase };