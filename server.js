const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const AI_API_KEY = process.env.AI_API_KEY;
const KAVENEGAR_API_KEY = process.env.KAVENEGAR_API_KEY;
const KAVENEGAR_TEMPLATE = process.env.KAVENEGAR_TEMPLATE;

// ذخیره موقت کدهای ورود
const otpStore = new Map();
const sendAttempts = new Map();

app.get("/", (req, res) => {
  res.send("Begal server is running!");
});

// یکسان‌سازی شماره موبایل ایران
function normalizeMobile(value) {
  const mobile = String(value || "").replace(/[^\d+]/g, "");

  if (/^09\d{9}$/.test(mobile)) {
    return "98" + mobile.slice(1);
  }

  if (/^\+989\d{9}$/.test(mobile)) {
    return mobile.slice(1);
  }

  if (/^989\d{9}$/.test(mobile)) {
    return mobile;
  }

  if (/^00989\d{9}$/.test(mobile)) {
    return mobile.slice(2);
  }

  return null;
}

// درخواست ارسال کد پیامکی
app.post("/auth/send-code", async (req, res) => {
  try {
    if (!KAVENEGAR_API_KEY || !KAVENEGAR_TEMPLATE) {
      return res.status(503).json({
        error: "تنظیمات کاوه‌نگار در Render کامل نشده است."
      });
    }

    const mobile = normalizeMobile(req.body.mobile);

    if (!mobile) {
      return res.status(400).json({
        error: "شماره موبایل ایران را درست وارد کنید."
      });
    }

    const now = Date.now();
    const lastSent = sendAttempts.get(mobile);

    if (lastSent && now - lastSent < 60000) {
      return res.status(429).json({
        error: "برای دریافت کد جدید یک دقیقه صبر کنید."
      });
    }

    const code = String(crypto.randomInt(100000, 1000000));

    const url = new URL(
      `https://api.kavenegar.com/v1/${encodeURIComponent(
        KAVENEGAR_API_KEY
      )}/verify/lookup.json`
    );

    url.searchParams.set("receptor", mobile);
    url.searchParams.set("token", code);
    url.searchParams.set("template", KAVENEGAR_TEMPLATE);

    const response = await fetch(url);
    const result = await response.json();

    if (!response.ok || result?.return?.status !== 200) {
      console.error("Kavenegar error:", result);

      return res.status(502).json({
        error: "ارسال پیامک ناموفق بود. تنظیمات کاوه‌نگار را بررسی کنید."
      });
    }

    otpStore.set(mobile, {
      code: code,
      expiresAt: now + 5 * 60 * 1000,
      tries: 0
    });

    sendAttempts.set(mobile, now);

    return res.json({
      ok: true,
      message: "کد تأیید ارسال شد. کد پنج دقیقه اعتبار دارد."
    });
  } catch (error) {
    console.error("SMS error:", error.message);

    return res.status(500).json({
      error: "خطا در ارسال پیامک."
    });
  }
});

// بررسی کد پیامکی
app.post("/auth/verify-code", (req, res) => {
  const mobile = normalizeMobile(req.body.mobile);
  const code = String(req.body.code || "").trim();

  if (!mobile || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      error: "شماره موبایل یا کد تأیید معتبر نیست."
    });
  }

  const saved = otpStore.get(mobile);

  if (!saved || Date.now() > saved.expiresAt) {
    otpStore.delete(mobile);

    return res.status(400).json({
      error: "کد منقضی شده است. دوباره کد بگیرید."
    });
  }

  saved.tries++;

  if (saved.tries > 5) {
    otpStore.delete(mobile);

    return res.status(429).json({
      error: "تعداد تلاش‌ها زیاد است. کد جدید بگیرید."
    });
  }

  if (saved.code !== code) {
    return res.status(400).json({
      error: "کد واردشده اشتباه است."
    });
  }

  otpStore.delete(mobile);

  return res.json({
    ok: true,
    verified: true,
    mobile: "+" + mobile,
    message: "شماره موبایل تأیید شد."
  });
});

// اتصال به هوش مصنوعی بگال
app.post("/chat", async (req, res) => {
  try {
    if (!AI_API_KEY) {
      return res.status(503).json({
        error: "AI_API_KEY در تنظیمات Render وارد نشده است."
      });
    }

    const messages = req.body.messages;

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        error: "فهرست پیام‌ها معتبر نیست."
      });
    }

    const response = await fetch(
      "https://1xai.ir/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${AI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: messages
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("AI provider error:", response.status, data);

      return res.status(502).json({
        error: "سرویس هوش مصنوعی پاسخ نداد."
      });
    }

    return res.json(data);
  } catch (error) {
    console.error("Begal error:", error.message);

    return res.status(500).json({
      error: "Begal connection failed"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Begal server started on port " + PORT);
});
