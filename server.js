const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// محل ذخیره موقت تصاویر رسید
const uploadDir = path.join("/tmp", "begal-receipts");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = file.mimetype === "image/png" ? ".png" : ".jpg";
    cb(null, crypto.randomUUID() + ext);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return cb(new Error("فقط تصویر JPG، PNG یا WEBP مجاز است."));
    }
    cb(null, true);
  }
});

app.get("/", (req, res) => {
  res.send("Begal server is running!");
});

// دریافت تصویر فیش پرداخت
app.post("/upload-receipt", (req, res) => {
  upload.single("receipt")(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.message || "خطا در دریافت تصویر"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "لطفاً تصویر فیش را انتخاب کنید."
      });
    }

    // فعلاً فقط دریافت فایل انجام می‌شود؛ تأیید پرداخت انجام نمی‌شود.
    return res.status(202).json({
      success: true,
      message: "تصویر دریافت شد، اما پرداخت هنوز تأیید نشده است."
    });
  });
});

// اتصال به سرویس هوش مصنوعی
app.post("/chat", async (req, res) => {
  try {
    if (!process.env.AI_API_KEY) {
      return res.status(500).json({ error: "کلید هوش مصنوعی تنظیم نشده است." });
    }

    if (!Array.isArray(req.body.messages)) {
      return res.status(400).json({ error: "پیام‌ها معتبر نیستند." });
    }

    const response = await fetch("https://1xai.ir/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.AI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: req.body.messages
      })
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error("Chat error:", err.message);
    return res.status(500).json({
      error: "اتصال بگال به هوش مصنوعی ناموفق بود."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Begal server started on port " + PORT);
});
