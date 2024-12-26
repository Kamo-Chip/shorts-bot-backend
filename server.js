require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const { v4: uuidv4 } = require("uuid");
const { SYSTEM_PROMPT, createSrt } = require("./utils");
const { exec } = require("child_process");
const app = express();

const port = process.env.PORT || 8080;

// ElevenLabs Configuration
const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// OpenAI Configuration
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";

app.use(express.json());

// Endpoint to generate script
app.post("/generate-script", async (req, res) => {
  const { text } = req.body;

  if (!text) {
    res.status(400).send("Text is required");
  }

  try {
    console.log("Generating script");
    const scriptResponse = await axios.post(
      OPENAI_API_URL,
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: `${text}`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        responseType: "text",
      }
    );

    const data = JSON.parse(scriptResponse.data);
    const script = data.choices[0].message.content;
    console.log("Successfully generated script: ", script);
    res.send({
      message: "Successsfully generated script",
      script,
    });
  } catch (error) {
    console.error("Error generating script:", error);
    res.status(500).send(error.message);
  }
});

// Endpoint to generate audio
app.post("/generate-audio", async (req, res) => {
  const { script, voiceId } = req.body;

  if (!script || !voiceId) {
    res.status(400).send("Script and voice ID is required");
  }

  try {
    console.log("Generating audio...");
    const outputFileName = `generated-audio/${uuidv4()}.mp3`;
    const outputPath = path.join(__dirname, outputFileName);

    const audioResponse = await axios.post(
      `${ELEVENLABS_API_URL}/${voiceId}`,
      {
        text: script,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    );
    fs.writeFileSync(outputPath, audioResponse.data);
    console.log("Successfully generated audio: ", outputFileName);
    res.send("Successfully generated audio");
  } catch (error) {
    console.error("Error generating audio:", error);
    res.status(500).send(error.message);
  }
});

// Endpoint to generate both script and audio
app.post("/generate-script-and-audio", async (req, res) => {
  const { text, voiceId } = req.body;

  if (!text || !voiceId) {
    res.status(400).send("Text and Voice ID are required");
    return;
  }

  try {
    // Step 1: Generate the script
    console.log("Generating script...");
    const scriptResponse = await axios.post(
      OPENAI_API_URL,
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: `${text}`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        responseType: "text",
      }
    );

    const scriptData = JSON.parse(scriptResponse.data);
    const script = scriptData.choices[0].message.content;
    console.log("Successfully generated script: ", script);

    // Step 2: Generate audio using the script
    console.log("Generating audio...");
    const outputFileName = `generated-audio/${uuidv4()}.mp3`;
    const outputPath = path.join(__dirname, outputFileName);

    const audioResponse = await axios.post(
      `${ELEVENLABS_API_URL}/${voiceId}`,
      {
        text: script,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    );
    fs.writeFileSync(outputPath, audioResponse.data);
    console.log("Successfully generated audio: ", outputFileName);
    // Respond with the result
    res.send({
      message: "Successfully generated script and audio",
      script,
      audioFile: outputFileName,
    });
  } catch (error) {
    console.error("Error generating script and audio:", error.message);
    res.status(500).send({ error: "An unexpected error occurred" });
  }
});

// Endpoint to transcribe audio
app.post("/transcribe-audio", async (req, res) => {
  const { filePath } = req.body;

  if (!filePath) {
    res.status(400).send("File path is required");
  }

  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));
  formData.append("timestamp_granularities[]", "word");
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");

  try {
    console.log("Transcribing audio...");
    const response = await axios.post(OPENAI_WHISPER_API_URL, formData, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders(),
      },
    });
    createSrt(response.data.words);
    res.send(response.data.words);
  } catch (error) {
    console.error("Error transcribing audio: ", error.message);
    res.status(500).send({ error: "An unexpected error occurred" });
  }
});

// Endpoint to generate clip
app.post("/generate-clip", async (req, res) => {
  const { audioFile, srtFile, bgImage } = req.body;
  const outputFile = `generated-clips/${uuidv4()}.mp4`;
  const command = `ffmpeg -loop 1 -i ${bgImage} -i ${audioFile} -vf "subtitles=${srtFile}:force_style='Alignment=10,Fontsize=36'" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest ${outputFile}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("Error generating clip: ", error.message);
      res.status(500).send("Error generating clip: ", error.message);
    }
    if (stderr) {
      console.error("FFmpeg stderr: ", stderr);
    }
    console.log("Successfully generated video: ", outputFile);
    res.send(`Successfully generated clip: ${outputFile}`);
  });
});

// Root Endpoint
app.get("/", (req, res) => res.send("Audio Backend is running!"));

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
