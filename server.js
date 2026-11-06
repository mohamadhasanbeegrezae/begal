const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(express.static(__dirname));

const PLANS = {
  monthly: {
    name: "اشتراک یک‌ماهه",
    amount: 3000000,
    days: 30
  },
  quarterly: {
    name: "اشتراک سه‌ماهه",
    amount: 5000000,
    days: 90
  },
  yearly: {
    name: "اشتراک یک‌ساله",
    amount: 15000000,
    days: 365
  }
};

const required = [
  "AI_API_KEY",
  "PAYEXA_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY"
];

function checkConfig() {
  return required.every(key => process.env[key]);
}

async function supabase(method, query, body) {
  const url =
    process.env.SUPABASE_URL +
    "/rest/v1/subscriptions" +
    query;

  const response = await fetch(url, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization:
        "Bearer " + process.env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Supabase database error");
  }

  return data;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Begal is running"
  });
});

app.get("/plans", (req, res) => {
  res.json({
    success: true,
    plans: PLANS
  });
});

// ایجاد پرداخت
app.post("/create-payment", async (req, res) => {
  try {
    if (!checkConfig()) {
      return res.status(500).json({
        success: false,
        error: "تنظیمات سرور کامل نیست."
      });
    }

    const { planId, userId } = req.body;
    const plan = PLANS[planId];

    if (!plan || !userId) {
      return res.status(400).json({
        success: false,
        error: "اطلاعات سفارش نامعتبر است."
      });
    }

    const orderId = crypto.randomUUID();

    const response = await fetch(
      "https://pay.pexn.ir/v2/payments",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.PAYEXA_API_KEY}`,
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

    const paymentId = String(result.data.payment_id);

    await supabase("POST", "", {
      user_id: userId,
      status: "pending",
      plan: planId,
      payment_id: paymentId,
      order_id: orderId
    });

    res.json({
      success: true,
      paymentUrl: result.data.payment_url,
      orderId
    });

  } catch (error) {
    console.error(error.message);

    res.status(500).json({
      success: false,
      error: "خطا در ایجاد پرداخت."
    });
  }
});

// تأیید پرداخت
app.all("/payexa-back", async (req, res) => {
  try {
    const paymentId = String(
      req.query.payment_id ||
      req.body?.payment_id ||
      ""
    );

    if (!paymentId) {
      return res.status(400).send(
        "شناسه پرداخت موجود نیست."
      );
    }

    const rows = await supabase(
      "GET",
      "?payment_id=eq." +
      encodeURIComponent(paymentId) +
      "&select=*"
    );

    if (!rows.length) {
      return res.status(404).send(
        "سفارش پیدا نشد."
      );
    }

    const payment = rows[0];

    if (payment.status === "active") {
      return res.send(
        "اشتراک قبلاً فعال شده است."
      );
    }

    const response = await fetch(
      "https://pay.pexn.ir/v2/payments/" +
      encodeURIComponent(paymentId) +
      "/verify",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.PAYEXA_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return res.status(400).send(
        "پرداخت تأیید نشد."
      );
    }

    if (
      String(result.data.order_id) !==
      String(payment.order_id)
    ) {
      return res.status(400).send(
        "شماره سفارش مطابقت ندارد."
      );
    }

    if (
      result.data.first_verification !== true
    ) {
      return res.send(
        "پرداخت قبلاً بررسی شده است."
      );
    }

    const plan = PLANS[payment.plan];

    if (!plan) {
      return res.status(400).send(
        "نوع اشتراک نامعتبر است."
      );
    }

    const expires = new Date();
    expires.setDate(
      expires.getDate() + plan.days
    );

    await supabase(
      "PATCH",
      "?payment_id=eq." +
      encodeURIComponent(paymentId),
      {
        status: "active",
        expires_at: expires.toISOString()
      }
    );

    res.send(
      "پرداخت تأیید شد و اشتراک فعال گردید."
    );

  } catch (error) {
    console.error(error.message);

    res.status(500).send(
      "خطا در تأیید پرداخت."
    );
  }
});

// بررسی وضعیت اشتراک
app.get("/subscription/:userId", async (req, res) => {
  try {
    const rows = await supabase(
      "GET",
      "?user_id=eq." +
      encodeURIComponent(req.params.userId) +
      "&status=eq.active&select=*"
    );

    const now = Date.now();

    const active = rows.find(row =>
      row.expires_at &&
      new Date(row.expires_at).getTime() > now
    );

    res.json({
      success: true,
      active: !!active,
      subscription: active || null
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "خطا در بررسی اشتراک."
    });
  }
});

// هوش مصنوعی
app.post("/chat", async (req, res) => {
  try {
    const response = await fetch(
      "https://1xai.ir/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.AI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: req.body.messages
        })
      }
    );

    const data = await response.json();

    res.status(response.status).json(data);

  } catch (error) {
    res.status(500).json({
      error: "خطای ارتباط با هوش مصنوعی."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Begal server running on " + PORT);
});
