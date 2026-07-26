const { createClient } = require("@supabase/supabase-js");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function logError({ source, message, details, businessId }) {
  try {
    await admin.from("error_logs").insert({
      source,
      message,
      details: details || null,
      business_id: businessId || null,
    });
  } catch (e) {
    console.error("Failed to write error_logs:", e.message);
  }
}

module.exports = { logError };