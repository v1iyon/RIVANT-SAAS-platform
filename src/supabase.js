const { createClient } = require("@supabase/supabase-js");

// service_role key — используем только на сервере (бот/крон), никогда не в браузере.
// Он обходит Row Level Security, поэтому все проверки доступа делаем сами в коде.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = { supabase };
