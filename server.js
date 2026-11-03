const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// تنظیمات عمومی
app.use(cors());
app.use(express.json({ limit: "8mb" }));

// نمایش فایل‌های سایت، از جمله index.html
app.use(express.static(__dirname));

// ذخیره موقت تصاویر رسید
const uploadDir = path.join("/tmp", "begal-receipts");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp"
    }[file.mimetype] || ".img";

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
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("فقط JPG، PNG و WEBP مجاز است."));
    }

    cb(null, true);
  }
});

// صفحه اصلی
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
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
        error: "لطفاً تصویر را انتخاب کنید."
      });
    }

    return res.status(202).json({
      success: true,
      message: "تصویر دریافت شد؛ پرداخت هنوز تأیید نشده است."
    });
  });
});

// بررسی پیام‌ها و تصاویر
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "پیام‌ها معتبر نیستند.";
  }

  for (const message of messages) {
    if (!["user", "assistant"].includes(message.role)) {
      return "نقش پیام معتبر نیست.";
    }

    const content = message.content;

    if (typeof content === "string") {
      if (content.length > 20000) {
        return "متن پیام بیش از حد طولانی است.";
      }
      continue;
    }

    if (!Array.isArray(content)) {
      return "محتوای پیام معتبر نیست.";
    }

    for (const item of content) {
      if (item.type === "text") {
        if (typeof item.text !== "string") {
          return "متن تصویر معتبر نیست.";
        }
      } else if (item.type === "image_url") {
        const url = item.image_url?.url;

        if (
          typeof url !== "string" ||
          !/^data:image\/(jpeg|png|webp);base64,/.test(url)
        ) {
          return "تصویر معتبر نیست.";
        }

        if (url.length > 7 * 1024 * 1024) {
          return "حجم تصویر بیش از حد مجاز است.";
        }
      } else {
        return "نوع محتوای پیام پشتیبانی نمی‌شود.";
      }
    }
  }

  return null;
}

// اتصال به هوش مصنوعی با پشتیبانی درخواست تصویر
app.post("/chat", async (req, res) => {
  try {
    if (!process.env.AI_API_KEY) {
      return res.status(500).json({
        error: "کلید هوش مصنوعی تنظیم نشده است."
      });
    }

    const messages = req.body.messages;
    const validationError = validateMessages(messages);

    if (validationError) {
      return res.status(400).json({
        error: validationError
      });
    }

    const response = await fetch(
      "https://1xai.ir/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.AI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: messages
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("AI API error:", response.status);

      return res.status(response.status).json({
        error: "سرویس هوش مصنوعی درخواست را نپذیرفت. ممکن است تحلیل تصویر در این سرویس فعال نباشد."
      });
    }

    return res.json(data);

  } catch (err) {
    console.error("Chat error:", err.message);

    return res.status(500).json({
      error: "اتصال بگال به هوش مصنوعی ناموفق بود."
    });
  }
});

// مدیریت خطاهای عمومی
app.use((err, req, res, next) => {
  console.error(err.message);

  res.status(500).json({
    error: "خطای داخلی سرور بگال."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Begal server started on port " + PORT);
});
