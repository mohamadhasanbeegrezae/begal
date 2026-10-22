const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Begal server is running!");
});

app.post("/chat", async (req, res) => {
  try {
    const apiKey = process.env.AI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "AI_API_KEY is missing in Render Environment"
      });
    }

    const response = await fetch(
      "https://1xai.ir/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: req.body.messages
        })
      }
    );

    const data = await response.json();

    return res.status(response.status).json(data);

  } catch (error) {
    console.error("Begal error:", error.message);

    return res.status(500).json({
      error: "Begal connection failed"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Begal server started");
});
