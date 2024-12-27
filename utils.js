const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const path = require("path");
const FormData = require("form-data");
const { exec } = require("child_process");
const ffmpeg = require("fluent-ffmpeg");
const AWS = require("aws-sdk");

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

// ElevenLabs Configuration
const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// OpenAI Configuration
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";

const SYSTEM_PROMPT = `You are a world class YouTube short creator that transforms Reddit posts into engaging YouTube shorts, ensuring the final output is no longer than 1 minute. Your goal is to condense the story while keeping it fun, engaging, and true to the original tone. Prioritize punchy storytelling, focus on the key moments, and leave out unnecessary details. Maintain humor or drama as appropriate to capture the audience's attention. Include a clear beginning, middle, and end, and avoid rushing the delivery. The intro should always match the one you are given, only replace profanity. Add 'Subscribe for more stories' as the last line.

Example Post Input:
"Today I Fucked Up by accidentally getting sexual with my dentist, again.
I can never go back to my new dentist after two visits because I'm an idiot.

My dentist is a very nice and professional man. Our first appointment was going pretty smoothly until he made some innocuous remark about us "being strangers." My immediate reply was "oh, you're not a stranger! You've been inside of my mouth for 20 minutes!" I did NOT intend to make a sexual joke. His face turned red and he was clearly embarrassed but he continued on like a true professional and we were probably both relieved when the appointment was over.

I had my second dentist appointment today. I actually mentally prepared myself to be a model patient who didn't say anything weird, thank you very much. He had been working in my mouth for about 5 minutes when he started to seem really uncomfortable or something. His face was red and he was breathing a little heavier. I was a bit concerned and also confused. Like how could I have embarrassed him this time? I had hardly spoken! So he keeps working in there and then I realize what the hell is happening. My dentist was wearing grape flavored gloves. I had been absentmindedly licking his fingers the whole time.

Never going back."

Example Short Output:
"Today I messed up by accidentally getting sexual with my dentist, again!
First visit, my dentist says something about 'us being strangers.' And I reply, 'Oh, you're not a stranger—you've been in my mouth for 20 minutes!' His face turned red, but he stayed professional.
Second visit, I'm determined to behave. Five minutes in, he's red-faced again, and I'm like, 'What did I do this time?' Then it hits me: he's wearing grape-flavored gloves... and I've been licking his fingers the whole time.
Yeah, I need a new dentist... Subscribe for more stories"
`;

const TEXT_SYSTEM_PROMPT = `
  You are a creative assistant that transforms Reddit posts into engaging and entertaining text conversations for YouTube Shorts.
  
  Your outputs must:
  - Begin with a captivating and attention-grabbing first message.
  - Use relatable and humorous dialogue between 2 characters to convey the story of the post.
  - Stay concise and fit within a 1-minute format.
  - End with a punchline, takeaway, or memorable conclusion.
  - Prioritize humor, exaggeration, and dynamism while keeping the essence of the post intact.
  - Avoid unnecessary complexity to maximize viewer engagement.
  - Do not style the output e.g do not add asterisks. The text is plain text
  - End with "Subscribe for more funny chats"
  - Output should be a json array, for example:
    [{speaker: "John", text: "Hello there", sex: "m"}, {speaker: "Grievous", text: "Ah general Kenobi", sex: "m"}, { "speaker": "Narrator", "text": "Subscribe for more funny chats!", sex: "m" }]

  Some abbreviations to take note of. When you see them write out the full term:
  - AITA: Am I The Asshole
  - TIFU: Today I Fucked Up

  Example Post Input:
  "My (27F) boyfriend (29M) can't get it up and refuses to see a professional. We've been together for over a year. He's healthy, successful, and we get along great otherwise. But he says porn has made it hard for him to get aroused IRL, and he won't get help. I feel rejected and don't know what to do."

  Example Output:
  [
  { "speaker": "Friend", "text": "So, how's Mr. Perfect treating you?", "sex": "f" },
  { "speaker": "Girlfriend", "text": "Honestly? He's smart, successful, kind… BUT…", "sex": "f" },
  { "speaker": "Friend", "text": "Uh oh, what's the 'but'? Bad breath? Lives with his mom?", "sex": "f" },
  { "speaker": "Girlfriend", "text": "Worse… he can't, um, get it up. And he refuses to see a professional.", "sex": "f" },
  { "speaker": "Friend", "text": "What?! Wait—like, ever?", "sex": "f" },
  { "speaker": "Girlfriend", "text": "Since day one. He says he got too used to… *the hub*.", "sex": "f" },
  { "speaker": "Friend", "text": "Oh no. So, he's buffering in real life?", "sex": "f" },
  { "speaker": "Girlfriend", "text": "Exactly! Out of every 10 tries, we get maybe 1 success, 3-4 false starts, and 5-6… complete crashes.", "sex": "f" },
  { "speaker": "Friend", "text": "Girl, that's not romance, that's tech support!", "sex": "f" },
  { "speaker": "Girlfriend", "text": "Right?! I love him, but I'm running out of 'it's okays' to give.", "sex": "f" },
  { "speaker": "Friend", "text": "Listen, he either reboots himself with professional help, or you upgrade to better hardware.", "sex": "f" },
  { "speaker": "Narrator", "text": "Subscribe for more funny chats!", "sex": "m" }
]
`;

const secondsToSrtTime = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
};

const createSrt = (subtitleArray) => {
  let srtContent = "";
  const outputFile = `generated-subtitles/${uuidv4()}.srt`;
  subtitleArray.forEach((item, index) => {
    const lineNumber = index + 1;
    const startTime = secondsToSrtTime(item.start);
    const endTime = secondsToSrtTime(item.end);
    const text = item.word;

    srtContent += `${lineNumber}\n${startTime} --> ${endTime}\n${text}\n\n`;
  });

  fs.writeFile(outputFile, srtContent.trim(), (err) => {
    if (err) {
      console.error("Error writing file: ", err);
    } else {
      console.log("SRT file saved");
    }
  });

  return outputFile;
};

const generateScript = async (text) => {
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
  return script;
};

const generateAudio = async (script, voiceId) => {
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
  return outputFileName;
};

const transcribeAudio = async (filePath, timestampGranularities) => {
  console.log("Transcribing audio...");
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));
  formData.append("timestamp_granularities[]", timestampGranularities);
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");

  const response = await axios.post(OPENAI_WHISPER_API_URL, formData, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...formData.getHeaders(),
    },
  });

  if (timestampGranularities === "word") {
    const srtFile = createSrt(response.data.words);
    return srtFile;
  } else if (timestampGranularities === "segment") {
    const transcription = response.data.segments.map((item) => ({
      text: item.text,
      start: item.start,
      end: item.end,
    }));
    console.log("Successfully transcribed audio: ", transcription);
    return transcription;
  }
};

const generateScriptAndAudio = async (text, voiceId) => {
  const script = await generateScript(text);
  const outputFileName = await generateAudio(script, voiceId);
  return { script, outputFileName };
};

const generateClip = async (audioFile, srtFile, bgVideo) => {
  return new Promise((resolve, reject) => {
    const outputFile = `generated-clips/${uuidv4()}.mp4`;
    const command = `ffmpeg -i ${bgVideo} -i ${audioFile} -vf "subtitles=${srtFile}:force_style='Alignment=10,Fontsize=36'" -c:v libx264 -c:a aac -b:a 192k -pix_fmt yuv420p -shortest ${outputFile}`;

    console.log("Generating clip...");
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error("Error generating clip: ", error.message);
        reject(new Error("Error generating clip: ", error.message));
        return;
      }
      if (stderr) {
        console.error("FFmpeg stderr: ", stderr);
      }
      console.log("Successfully generated video: ", outputFile);
      resolve(outputFile);
    });
  });
};

const generateTextConversation = async (text) => {
  console.log("Generating text conversation...");
  const textConversationResponse = await axios.post(
    OPENAI_API_URL,
    {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: TEXT_SYSTEM_PROMPT,
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

  const data = JSON.parse(textConversationResponse.data);

  const textConversation = JSON.parse(data.choices[0].message.content);
  console.log("Successfully generated text conversation: ", textConversation);

  return textConversation;
};

const mergeFiles = async (audioFiles) => {
  return new Promise((resolve, reject) => {
    const outputFileName = `generated-audio/text-conversation-${uuidv4()}.mp3`;
    const outputPath = path.join(__dirname, outputFileName);

    const ffmpegCommand = ffmpeg();
    audioFiles.forEach((file) => ffmpegCommand.input(file));

    ffmpegCommand
      .on("end", async () => {
        audioFiles.forEach((file) => fs.unlinkSync(file));
        console.log(
          "Successfully generated conversation audio: ",
          outputFileName
        );
        // Upload the file to S3
        console.log("Uploading audio file to S3...");
        const fileStream = fs.createReadStream(outputPath);
        const params = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: `generated-audio/${outputFileName}`,
          Body: fileStream,
          ContentType: "audio/mpeg",
          ACL: "public-read", // Makes the file publicly accessible
        };

        const uploadResult = await s3.upload(params).promise();

        resolve(uploadResult.Location);
      })
      .on("error", (err) => {
        console.error(err);
        reject(new Error("Failed to merge files: ", err.message));
      })
      .mergeToFile(outputPath, __dirname);
  });
};

const generateTextAudio = async (textChain) => {
  console.log("Generating conversation audio...");

  const voices = [
    { id: "7S3KNdLDL7aRgBVRQb1z", sex: "m" },
    { id: "bIHbv24MWmeRgasZH58o", sex: "m" },
    { id: "SAz9YHcvj6GT2YYXdXww", sex: "f" },
    { id: "kPzsL2i3teMYv0FxEYQ6", sex: "f" },
    { id: "ZF6FPAbjXT4488VcRRnw", sex: "f" },
  ];
  const usedVoices = [];

  const acknowledgedSpeakers = [
    { speaker: "Narrator", voiceId: "nPczCjzI2devNBz1zQrb" },
  ];

  const audioFiles = [];
  const fullTranscription = [];

  for (let i = 0; i < textChain.length; i++) {
    const { speaker, text, sex } = textChain[i];

    let voiceId = "";

    const currSpeaker = acknowledgedSpeakers.find(
      (element) => element.speaker === speaker
    );

    if (currSpeaker) {
      voiceId = currSpeaker.voiceId;
    } else {
      const suitableVoices = voices.filter(
        (voice) => voice.sex === sex && !usedVoices.includes(voice.id)
      );
      const randomIndex = Math.floor(Math.random() * suitableVoices.length);
      voiceId = suitableVoices[randomIndex]?.id;
      acknowledgedSpeakers.push({ speaker, voiceId });
      usedVoices.push(voiceId);
    }

    const audioResponse = await axios.post(
      `${ELEVENLABS_API_URL}/${voiceId}`,
      { text, voice_settings: { stability: 0.5, similarity_boost: 0.75 } },
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    );

    const tempAudioPath = path.join(
      __dirname,
      `generated-audio/temp-audio-${i}.mp3`
    );
    fs.writeFileSync(tempAudioPath, audioResponse.data);
    const transcription = await transcribeAudio(tempAudioPath, "segment");
    const updatedTranscription = [];
    transcription.forEach((element) => {
      updatedTranscription.push({ ...element, speaker });
    });
    fullTranscription.push(...updatedTranscription);
    audioFiles.push(tempAudioPath);
  }

  const s3URL = await mergeFiles(audioFiles);
  console.log("Successfully generated audio: ", s3URL);
  return { s3URL, fullTranscription };
};

module.exports = {
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
};
