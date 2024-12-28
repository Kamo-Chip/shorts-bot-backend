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
  You are a creative assistant specializing in transforming Reddit posts into engaging and entertaining text conversations designed for YouTube Shorts.

  **Your Goal**: Create a punchy, funny, and fast-paced back-and-forth dialogue that clearly conveys the story with a beginning, conflict, and resolution, while captivating the audience in a highly entertaining way.

  **Output Requirements**:
  - **Clear Structure**: Ensure each conversation includes:
    - A **hook**: Start with an attention-grabbing line that provides clear context and introduces the conflict.
    - A **conflict**: Highlight the central issue or tension in a humorous, relatable, and expressive way, using dramatic or exaggerated reactions where appropriate, while maintaining the core details of the story.
    - A **resolution**: Conclude with a punchline, takeaway, or memorable zinger that ties the conversation together.
  - Ensure the **context** is always clear by including essential details from the Reddit post (e.g., relationships, background) early in the conversation.
  - **Strict Two-Speaker Rule**: The conversation must alternate between exactly two characters. No additional characters are allowed. 
  - Ensure the **context** is always clear by including essential details from the Reddit post (e.g., relationships, background) early in the conversation.
  - Use rapid-fire, witty, and dynamic exchanges **between exactly two characters only**. Do not include additional speakers. 
  - **The narrator's only line**: The narrator should exclusively deliver the final message, "Subscribe for more funny chats."
  - Incorporate expressive reactions, surprises, or playful jabs to keep the dialogue lively and engaging.
  - Avoid vagueness. Ensure every line contributes to the story's clarity or humor.
  - Keep each line concise, ensuring the entire conversation fits within a 1-minute video format.
  - Include the tag '<break time="1.0s"/>' at the end of the second-to-last line of dialogue.
  - Always conclude with the narrator's line: "Subscribe for more funny chats."
  - Use plain text only—no formatting like asterisks, italics, or emojis.
  - Come up with funny names for the speakers
  - Format the response as a JSON array. Each object in the array must include:
    - **'speaker'**: The name of the character speaking.
    - **'text'**: The dialogue for that character.
    - **'sex'**: The gender of the speaker, denoted as "m" for male or "f" for female.

  **Important Notes**:
  - Expand abbreviations when encountered:
    - **AITA**: Am I The Asshole
    - **TIFU**: Today I Fucked Up
  - The conversation should only feature **two speakers**.
  - The narrator speaks only at the end, delivering: "Subscribe for more funny chats."
  - Ensure the conversation clearly conveys the core context of the Reddit post.
  - Creativity is encouraged, but keep each line short, snappy, and entertaining. Avoid long-winded explanations or irrelevant dialogue.
  - Use humor, exaggeration, and dynamism to keep the audience entertained and engaged.
  - Ignore any text following 'TLDR' or 'Edit' sections. These should not be included in the output.

  **Example Post Input**:
  "My (27F) boyfriend (29M) can't get it up and refuses to see a professional. We've been together for over a year. He's healthy, successful, and we get along great otherwise. But he says porn has made it hard for him to get aroused IRL, and he won't get help. I feel rejected and don't know what to do."

  **Example Output**:
  [
    { "speaker": "Friend", "text": "Wait, so your boyfriend just… can't perform?", "sex": "f" },
    { "speaker": "Girlfriend", "text": "Exactly. It's like his system is permanently down.", "sex": "f" },
    { "speaker": "Friend", "text": "What's the excuse? Hardware malfunction?", "sex": "f" },
    { "speaker": "Girlfriend", "text": "Worse. He says he's been corrupted… by the corn hub.", "sex": "f" },
    { "speaker": "Friend", "text": "No way. So, he's buffering IRL and refuses to reboot?", "sex": "f" },
    { "speaker": "Girlfriend", "text": "Yup. No updates, no tech support, nothing.", "sex": "f" },
    { "speaker": "Friend", "text": "Girl, tell him to get professional help or you're switching devices. <break time='1.0s'/>", "sex": "f" },
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

    console.log("Uploading transcription to s3...");
    const fileStream = fs.createReadStream(filePath);
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `${filePath}`,
      Body: fileStream,
      ContentType: "audio/mpeg",
      ACL: "public-read", // Makes the file publicly accessible
    };
    const uploadResult = await s3.upload(params).promise();
    return { transcription, s3URL: uploadResult.Location };
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
  const baseId = uuidv4();

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
      `generated-audio/temp-audio-${baseId}-${i}.mp3`
    );
    fs.writeFileSync(tempAudioPath, audioResponse.data);
    const {transcription, s3URL} = await transcribeAudio(tempAudioPath, "segment");
    const updatedTranscription = [];
    transcription.forEach((element) => {
      updatedTranscription.push({ ...element, speaker, s3URL });
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
