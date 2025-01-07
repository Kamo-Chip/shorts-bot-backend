require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const AWS = require("aws-sdk");
const {
  SYSTEM_PROMPT,
  createSrt,
  ELEVENLABS_API_URL,
  ELEVENLABS_API_KEY,
  OPENAI_API_URL,
  OPENAI_WHISPER_API_URL,
  generateScript,
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

// AWS S3 Configuration
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const app = express();

const port = process.env.PORT || 8080;

app.use(express.json());

app.post("/generate-script", async (req, res) => {
  const { text } = req.body;

  try {
    const script = await generateScript(text, "short");
    res.send({ message: "Successfully generated script", script });
  } catch (error) {
    console.error(error.message);
    res.status(500).send(`Failed to generate script: ${error.message}`);
  }
});
// Endpoint to transcribe audio
app.post("/transcribe-audio", async (req, res) => {
  const { filePath, timestampGranularities } = req.body;

  if (!filePath) {
    res.status(400).send("File path is required");
  }

  try {
    const transcription = await transcribeAudio(
      filePath,
      timestampGranularities
    );

    res.send({
      message: "Successfully transcribed audio",
      transcription,
    });
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
  const { bgVideo, text, voiceId, bgSound } = req.body;

  if (!bgVideo || !text || !voiceId || !bgSound) {
    res.status(400).send("There are missing fields");
  }

  try {
    const { outputFileName } = await generateScriptAndAudio(
      text,
      voiceId,
      "short"
    );
    const srtFile = await transcribeAudio(outputFileName, "word");
    console.log("Files: ", outputFileName);
    console.log("SRT: ", srtFile);
    console.log("BG: ", bgVideo);
    const outputFile = await generateClip(
      outputFileName,
      srtFile,
      bgVideo,
      bgSound
    );

    // Upload the file to S3
    console.log("Uploading audio file to S3...");
    const fileStream = fs.createReadStream(outputFile);
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: outputFile,
      Body: fileStream,
      ContentType: "video/mp4",
      ACL: "public-read", // Makes the file publicly accessible
    };

    const uploadResult = await s3.upload(params).promise();

    res.send({
      message: `Successfully generated short`,
      url: uploadResult.Location,
    });
  } catch (error) {
    console.error("Failed to generate short: ", error);
    res.status(500).send("Failed to generate short");
  }
});

// Endpoint to generate confession
app.post("/generate-confession", async (req, res) => {
  const { bgVideo, text, voiceId, bgSound, isVerbatim } = req.body;

  if (!bgVideo || !text || !voiceId || !bgSound || !isVerbatim) {
    res.status(400).send("There are missing fields");
  }

  try {
    const { outputFileName } = await generateScriptAndAudio(
      text,
      voiceId,
      "confession",
      isVerbatim
    );
    const srtFile = await transcribeAudio(outputFileName, "word");
    console.log("Files: ", outputFileName);
    console.log("SRT: ", srtFile);
    console.log("BG: ", bgVideo);
    const outputFile = await generateClip(
      outputFileName,
      srtFile,
      bgVideo,
      bgSound
    );

    // Upload the file to S3
    console.log("Uploading audio file to S3...");
    const fileStream = fs.createReadStream(outputFile);
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: outputFile,
      Body: fileStream,
      ContentType: "video/mp4",
      ACL: "public-read", // Makes the file publicly accessible
    };

    const uploadResult = await s3.upload(params).promise();

    res.send({
      message: `Successfully generated confession`,
      url: uploadResult.Location,
    });
  } catch (error) {
    console.error("Failed to generate confession: ", error);
    res.status(500).send("Failed to generate confession");
  }
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
