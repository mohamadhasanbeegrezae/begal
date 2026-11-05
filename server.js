const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(express.static(__dirname));

const PLANS = {
  monthly: {
    name: "اشتراک یک‌ماهه",
    price: 300000,
    amount: 3000000,
    days: 30
  },
  quarterly: {
    name: "اشتراک سه‌ماهه",
    price: 500000,
    amount: 5000000,
    days: 90
  },
  yearly: {
    name: "اشتراک یک‌ساله",
    price: 1500000,
    amount: 15000000,
    days: 365
  }
};

const payments = new Map();
const verifiedPayments = new Set();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(
      null,
      ["image/jpeg", "image/png", "image/webp"]
        .includes(file.mimetype)
    );
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Begal server is running"
  });
});

app.get("/plans", (req, res) => {
  res.json({
    success: true,
    plans: Object.entries(PLANS).map(([id, p]) => ({
      id,
      name: p.name,
      price: p.price,
      currency: "تومان",
      durationDays: p.days
    }))
  });
});

// ایجاد پرداخت
app.post("/create-payment", async (req, res) => {
  try {
    const { planId, userId } = req.body;

    const plan = PLANS[planId];

    if (!plan || typeof userId !== "string" || !userId.trim()) {
      return res.status(400).json({
        success: false,
        error: "اطلاعات سفارش معتبر نیست."
      });
    }

    if (!process.env.PAYEXA_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "کلید پرداخت تنظیم نشده است."
      });
    }

    const orderId = crypto.randomUUID();

    const response = await fetch(
      "https://pay.pexn.ir/v2/payments",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYEXA_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: plan.amount,
          order_id: orderId,
          callback_url:
            "https://begal.onrender.com/payexa-back"
        })
      }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return res.status(502).json({
        success: false,
        error: "ایجاد پرداخت ناموفق بود."
      });
    }

    const paymentId = result.data.payment_id;

    payments.set(String(paymentId), {
      orderId,
      userId: userId.trim(),
      planId,
      createdAt: Date.now()
    });

    res.json({
      success: true,
      paymentUrl: result.data.payment_url,
      orderId
    });

  } catch (error) {
    console.error("Payment error:", error.message);

    res.status(500).json({
      success: false,
      error: "خطا در ایجاد پرداخت."
    });
  }
});

// بازگشت و تأیید پرداخت
app.all("/payexa-back", async (req, res) => {
  try {
    const paymentId =
      req.query.payment_id ||
      req.body?.payment_id;

    if (!paymentId) {
      return res.status(400).send("شناسه پرداخت موجود نیست.");
    }

    const payment = payments.get(String(paymentId));

    if (!payment) {
      return res.status(404).send("سفارش پیدا نشد.");
    }

    if (verifiedPayments.has(String(paymentId))) {
      return res.send("این پرداخت قبلاً تأیید شده است.");
    }

    const response = await fetch(
      `https://pay.pexn.ir/v2/payments/${encodeURIComponent(paymentId)}/verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYEXA_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return res.status(400).send("پرداخت تأیید نشد.");
    }

    if (result.data.first_verification !== true) {
      return res.send("پرداخت قبلاً بررسی شده است.");
    }

    if (
      String(result.data.order_id) !==
      String(payment.orderId)
    ) {
      return res.status(400).send("شماره سفارش مطابقت ندارد.");
    }

    // فعال‌سازی اشتراک باید پس از اتصال Supabase انجام شود.
    verifiedPayments.add(String(paymentId));

    res.send(
      "پرداخت با موفقیت تأیید شد. درخواست فعال‌سازی اشتراک ثبت شد."
    );

  } catch (error) {
    console.error("Verification error:", error.message);

    res.status(500).send("خطا در تأیید پرداخت.");
  }
});

// دریافت تصویر در گفتگو
app.post("/upload-image", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "تصویر معتبر نیست."
    });
  }

  res.json({
    success: true,
    message: "تصویر دریافت شد."
  });
});

// اعتبارسنجی پیام‌ها
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }

  if (messages.length > 50) return false;

  return messages.every(message => {
    if (!["user", "assistant"].includes(message.role)) {
      return false;
    }

    if (typeof message.content === "string") {
      return message.content.length <= 20000;
    }

    return Array.isArray(message.content);
  });
}

// اتصال هوش مصنوعی
app.post("/chat", async (req, res) => {
  try {
    if (!process.env.AI_API_KEY) {
      return res.status(500).json({
        error: "کلید هوش مصنوعی تنظیم نشده است."
      });
    }

    const messages = req.body.messages;

    if (!validateMessages(messages)) {
      return res.status(400).json({
        error: "پیام‌ها معتبر نیستند."
      });
    }

    const response = await fetch(
      "https://1xai.ir/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: "ارتباط با هوش مصنوعی ناموفق بود."
      });
    }

    res.json(data);

  } catch (error) {
    console.error("AI error:", error.message);

    res.status(500).json({
      error: "خطای ارتباط با هوش مصنوعی."
    });
  }
});

app.use((error, req, res, next) => {
  console.error(error.message);

  res.status(500).json({
    success: false,
    error: "خطای داخلی سرور بگال."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Begal server started on port " + PORT);
});
