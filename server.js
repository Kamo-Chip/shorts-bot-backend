require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const {
  SYSTEM_PROMPT,
  createSrt,
  ELEVENLABS_API_URL,
  ELEVENLABS_API_KEY,
  OPENAI_API_URL,
  OPENAI_WHISPER_API_URL,
  generateScriptAndAudio,
  transcribeAudio,
  generateClip,
  TEXT_SYSTEM_PROMPT,
  generateTextConversation,
  generateTextAudio,
} = require("./utils");
const { exec } = require("child_process");
const ffmpeg = require("fluent-ffmpeg");

const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffprobePath = require("@ffprobe-installer/ffprobe").path;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);
const app = express();

const port = process.env.PORT || 8080;

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
    const { script, outputFileName } = await generateScriptAndAudio(
      text,
      voiceId
    );

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
  const { filePath, timestampGranularities } = req.body;

  if (!filePath) {
    res.status(400).send("File path is required");
  }

  try {
    await transcribeAudio(filePath, timestampGranularities);
    res.send(`Successfully transcribed audio`);
  } catch (error) {
    console.error("Error transcribing audio: ", error.message);
    res.status(500).send({ error: "An unexpected error occurred" });
  }
});

// Endpoint to generate clip
app.post("/generate-clip", async (req, res) => {
  const { audioFile, srtFile, bgVideo } = req.body;

  try {
    const outputFile = await generateClip(audioFile, srtFile, bgVideo);
    res.send(`Successfully generated clip: ${outputFile}`);
  } catch (error) {
    console.error("Failed to generate clip: ", error.message);
    res.status(500).send("Failed to generate clip");
  }
});

// Endpoint to generate script, audio, transcription and clip
app.post("/generate-short", async (req, res) => {
  const { bgVideo, text, voiceId } = req.body;

  if (!bgVideo || !text || !voiceId) {
    res.status(400).send("There are missing fields");
  }

  try {
    const { outputFileName } = await generateScriptAndAudio(text, voiceId);
    const srtFile = await transcribeAudio(outputFileName);
    console.log("Files: ", outputFileName);
    console.log("SRT: ", srtFile);
    console.log("BG: ", bgVideo);
    const outputFile = await generateClip(outputFileName, srtFile, bgVideo);
    res.send(`Successfully generated video: ${outputFile}`);
  } catch (error) {
    console.error("Failed to generate short: ", error);
    res.status(500).send("Failed to generate short");
  }
});

// Endpoint to generate text conversation
app.post("/generate-text-conversation", async (req, res) => {
  const { text } = req.body;

  if (!text) {
    res.status(400).send("Text is required");
  }

  try {
    await generateTextConversation(text);

    res.send("Successfully generated text conversation");
  } catch (error) {
    console.error("Error generating text conversation:", error);
    res.status(500).send(error.message);
  }
});

app.post("/generate-text-audio", async (req, res) => {
  const { textChain: textChainStr } = req.body;

  try {
    await generateTextAudio(textChainStr);
  } catch (error) {
    console.error("Error generating conversation audio:", error);
    res.status(500).send(error.message);
  }

  res.send("Done");
});

app.post("/generate-text-conversation-and-audio", async (req, res) => {
  const { text } = req.body;

  if (!text) {
    res.status(400).send("Text is required");
  }

  try {
    const textConversation = await generateTextConversation(text);
    const { s3URL, fullTranscription } = await generateTextAudio(
      textConversation
    );

    res.send({
      message: "Successfully generated text conversation",
      s3URL,
      fullTranscription,
    });
  } catch (error) {
    console.error("Error generating text conversation and audio:", error);
    res.status(500).send(error.message);
  }
});
// Root Endpoint
app.get("/", (req, res) => res.send("Audio Backend is running!"));

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
