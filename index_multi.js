// filename: news-reel-automation.mjs
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import dayjs from "dayjs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import dotenv from "dotenv";
import sharp from "sharp";
import { exec } from "child_process";
import getAllFinalVideosByDate from "./pushYoutube.js";

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);

// ---------- UTILS ----------
function getYesterday() {
  // return dayjs().subtract(1, "day").format("YYYY-MM-DD");
  return dayjs().format("YYYY-MM-DD");
}

function getOutputDirForDate(date) {
  const dir = path.join(process.cwd(), "output", date);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ✅ Clean Gemini JSON response
function cleanGeminiJSON(text) {
  if (!text) return "{}";
  let cleaned = text.trim();

  // remove markdown fences
  cleaned = cleaned.replace(/^```json/i, "").replace(/^```/, "");
  cleaned = cleaned.replace(/```$/, "");

  // remove accidental leading/trailing junk
  const firstCurly = cleaned.indexOf("{");
  const lastCurly = cleaned.lastIndexOf("}");
  if (firstCurly !== -1 && lastCurly !== -1) {
    cleaned = cleaned.substring(firstCurly, lastCurly + 1);
  }

  return cleaned.trim();
}

// ---------- CONFIG ----------
const voice = "onyx";
const vibe = {
  Voice: "Confident, high-energy — like a breaking-news anchor on speed mode.",
  Tone: "Sharp, dynamic, and urgent — captures attention instantly with no downtime.",
  Pacing:
    "Fast and continuous; headlines delivered in a machine-gun rhythm, with slightly slower pacing for secondary details before snapping back to rapid-fire.",
  Emotion:
    "Controlled urgency with subtle variation — urgency dominates, but allow tiny pitch shifts every few headlines to keep it human and engaging.",
  Pronunciation:
    "Very crisp and precise. Emphasize impact words like 'breaking,' 'alert,' 'urgent,' while letting filler words glide quickly.",
  Pauses:
    "Micro-pauses only — about 0.3–0.4s between headlines for breathing space, slightly longer (0.6s) after big impactful news before resuming speed.",
};

// ---------- NEWS (via Gemini) ----------
async function getNews(date) {
  console.log("📰 Fetching news from Gemini for", date, "...");

  const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
  if (!GEMINI_KEY) {
    console.warn("⚠️ No Gemini API key found");
    return { India: [], World: [] };
  }

  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const models = [
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-pro",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
  ]; // fallback list
  let lastError;
  //  "title": "Generic headline for the bulletin with some hashtags, date, and 'With In 24 Hours News'",
  // "tags": "SEO-friendly, keyword-rich tags (approx. 250 characters, comma-separated) related to the news",
  // "hashtags": "SEO-friendly, keyword-rich hashtags (comma-separated) related to the news",

  const prompt =
    () => `You are a professional multilingual journalist and an expert geopolitical and economic analyst.
Your task is to prepare a "Daily Knowledge Bulletin" for ${date} in valid JSON format, focusing on detailed, non-generic analysis.

**Strict rules**:
0. After generating the Hindi and Gujarati text, perform a final review to ensure perfect spelling and grammar.
1. Insert CTA Message at the end of **only one** description (either in India or World section).
2. Focus on providing **detailed, non-generic information** in all fields, especially the 'description' and 'why_it_matters' sections.
3. Provide only 4-5 major key events in each section ("India" and "World").
4. News must be serious and knowledgeable: policy, economy, environment, science, technology, health, defence, or international relations.
5. Exclude entertainment, celebrity, lifestyle, and sports.
6. Do not use apostrophes in any field.
7. After generating the Hindi and Gujarati text, perform a final proofreading step to strictly check and correct spelling, grammar, and natural phrasing. Output must read as if written by a native speaker with no mistakes.
8. Return only the final valid JSON object with no comments, explanations, or extra text.

The JSON must strictly follow this structure and be returned as a single valid JSON object only.
{

  "India": [
    {
      "english": {
        "title": "Factual headline (around 50 characters)",
        "description": "Concise 2–3 sentence summary focusing on concrete, verifiable details. Avoid vague phrases like 'concerns remain' or 'mixed results'.",
        "why_it_matters": "Sharp, 1–2 sentence analysis on the long-term impact on policy, economy, tech, science, or geopolitics. Explain the 'so what?' factor."
      },
      "hindi": {
        "title": "गंभीर और सटीक हिन्दी शीर्षक (लगभग 50 अक्षर)",
        "description": "तथ्यों पर आधारित 2–3 वाक्य का संक्षिप्त सारांश। वाक्य में विशिष्ट और ठोस जानकारी होनी चाहिए।",
        "why_it_matters": "नीति, अर्थव्यवस्था, विज्ञान, या रक्षा पर दीर्घकालिक और वास्तविक प्रभाव का विश्लेषण।"
      },
      "gujarati": {
        "title": "મુખ્ય અને સચોટ ગુજરાતી શીર્ષક (લગભગ 50 અક્ષર)",
        "description": "તથ્ય આધારિત 2–3 વાક્યનું સંક્ષિપ્ત વર્ણન. વર્ણનમાં ચોક્કસ અને મજબૂત માહિતી હોવી જોઈએ.",
        "why_it_matters": "નીતિ, અર્થતંત્ર, વિજ્ઞાન અથવા રક્ષણ પર લાંબા ગાળાનો અને વાસ્તવિક પ્રભાવ."
      },
      "india": true
    }
  ],
  "World": [
    {
      "english": {
        "title": "Factual headline (around 50 characters)",
        "description": "Concise 2–3 sentence summary focusing on concrete, verifiable details. Avoid vague phrases.",
        "why_it_matters": "Sharp, 1–2 sentence analysis on the long-term impact on geopolitics, economy, climate, or health. Explain the 'so what?' factor."
      },
      "hindi": {
        "title": "गंभीर और सटीक हिन्दी शीर्षक (लगभग 50 अक्षर)",
        "description": "तथ्यों पर आधारित 2–3 वाक्य का संक्षिप्त सारांश।",
        "why_it_matters": "अंतरराष्ट्रीय नीति, अर्थव्यवस्था, विज्ञान या रक्षा पर वास्तविक और दीर्घकालिक प्रभाव।"
      },
      "gujarati": {
        "title": "મુખ્ય અને સચોટ ગુજરાતી શીર્ષક (લગભગ 50 અક્ષર)",
        "description": "તથ્ય આધારિત 2–3 વાક્યનું સંક્ષિપ્ત વર્ણન.",
        "why_it_matters": "આંતરરાષ્ટ્રીય નીતિ, અર્થતંત્ર, વિજ્ઞાન અથવા રક્ષણ પર વાસ્તવિક અને લાંબા ગાળાનો પ્રભાવ."
      }
    }
  ]
 "title": The single best catchy YouTube Shorts title (45–60 characters) with India & Global context, urgency and curiosity hooks (e.g., "Shocking", "Within 24 Hrs"), today’s date (e.g., 22 Sept 2025), and 1–2 strong hashtags; return only the title text.
 "tags": 8–12 SEO-friendly, keyword-rich tags (approx. 250 characters, comma-separated) related to India & Global news, breaking news, economy, technology, geopolitics, and world updates.
 "hashtags": 3–5 relevant, keyword-rich hashtags (comma-separated) for YouTube Shorts, reflecting urgency and trending topics in India & Global news.
}`;

  for (let attempt = 0; attempt < models.length; attempt++) {
    const modelName = models[attempt];
    try {
      console.log(
        `🔄 Attempt ${attempt + 1} with model: ${modelName} prompt: ${prompt()}`
      );
      const model = genAI.getGenerativeModel({ model: modelName });

      const res = await model.generateContent(await prompt());

      // ✅ Extract raw text
      const text = res?.response?.text ? res.response.text().trim() : "";
      // console.log("✅ Gemini raw output:", text);

      // ✅ Parse JSON safely
      let parsed;
      try {
        const cleaned = cleanGeminiJSON(text);
        parsed = JSON.parse(cleaned);
      } catch (e) {
        throw new Error("Gemini returned invalid JSON: " + text);
      }

      // ✅ Always return arrays
      const safeParsed = {
        India: Array.isArray(parsed.India) ? parsed.India : [],
        World: Array.isArray(parsed.World) ? parsed.World : [],
      };
      const youtubeSEO = {
        Title: parsed.title,
        Tags: parsed.tags,
        Hashtags: parsed.hashtags,
      };

      // ✅ Stop retrying if we got valid news
      if (safeParsed.India.length > 0 || safeParsed.World.length > 0) {
        console.log(
          `✅ Got ${safeParsed.India.length} India news & ${safeParsed.World.length} World news`
        );
        return { safeParsed, youtubeSEO };
      }

      throw new Error("Empty news arrays");
    } catch (err) {
      lastError = err;
      console.error(`❌ Attempt ${attempt + 1} failed:`, err.message);

      // If it's the last attempt, break
      if (attempt === models.length - 1) break;
    }
  }

  // ✅ Fallback result if all retries fail
  console.error("❌ All retries failed:", lastError?.message);
  return { India: [], World: [] };
}

// ---------- TTS ----------
async function fetchTTS({ content, folderPath }) {
  const apiUrl = "https://www.openai.fm/api/generate";
  try {
    const finalURL = `${apiUrl}?input=${encodeURIComponent(
      content
    )}&prompt=${encodeURIComponent(
      JSON.stringify(vibe)
    )}&voice=${voice}&generation=67612c8-4975-452f-af3f-d44cca8915e5`;

    const res = await axios.get(finalURL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/115.0.0.0 Safari/537.36",
      },
      responseType: "arraybuffer",
      timeout: 60_000,
    });

    fs.writeFileSync(folderPath, res.data);
    console.log(`✅ Audio saved: ${folderPath}`);
  } catch (err) {
    console.error("❌ Failed TTS:", err.message);
    throw err;
  }
}

// ---------- FFPROBE (promise wrapper) ----------
function ffprobePromise(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata);
    });
  });
}

// ---------- GOOGLE IMAGE SCRAPING ----------
async function fetchImage(query, savePath) {
  const url = `https://in.images.search.yahoo.com/search/images?p=${encodeURIComponent(
    query
  )}`;
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });

    const $ = cheerio.load(data);
    let firstValidImage = null;

    $("li.ld").each((i, el) => {
      if (firstValidImage) return; // stop after first valid

      const dataAttr = $(el).attr("data") || "";
      const ariaLabel = $(el).find("a.img").attr("aria-label") || "";
      const imgSrc =
        $(el).find("img").attr("data-src") || $(el).find("img").attr("src");

      if (!imgSrc) return;

      if (dataAttr.toLowerCase().includes("youtube")) {
        console.log(`❌ Skipped (YouTube) #${i + 1}`);
      } else {
        // Clean URL (remove ?pid= and other query params)
        const cleanUrl = imgSrc.split("?")[0];
        firstValidImage = { ariaLabel, cleanUrl };
        console.log(`✅ First Valid Image Found:`);
        // console.log(`   🏷️ ${ariaLabel}`);
        // console.log(`   📷 ${cleanUrl}`);
      }
    });

    // ✅ Download the first valid image
    if (firstValidImage) {
      const response = await axios.get(firstValidImage.cleanUrl, {
        responseType: "arraybuffer",
      });
      await sharp(response.data)
        .resize(970, 950, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 }, // red
        })
        .png()
        .toFile(savePath);

      console.log(`💾 Image saved as ${savePath}`);
    } else {
      console.log("⚠️ No valid images to download!");
    }
  } catch (err) {
    console.error("❌ Error fetching images:", err.message);
  }

  return savePath;
}

async function getVideoDimensions(videoFile) {
  const metadata = await ffprobePromise(videoFile);
  const stream = metadata.streams.find((s) => s.width && s.height);
  return { width: stream.width, height: stream.height };
}

// ---------- PREPARE TEXT ----------
function prepareText(text, maxLineLength = 45) {
  const words = text.split(" ");
  let lines = [];
  let line = "";

  words.forEach((word) => {
    if ((line + word).length > maxLineLength) {
      lines.push(line.trim());
      line = word + " ";
    } else {
      line += word + " ";
    }
  });
  if (line) lines.push(line.trim());
  return lines.join("\n");
}

function overlayImage(path) {
  const { videoFile, imageFile, outputFile } = path;
  // console.log("🎬 Input video:", videoFile);
  // console.log("🖼️ Input image:", imageFile);
  // console.log("📂 Output file:", outputFile);

  return new Promise((resolve, reject) => {
    if (!videoFile || !imageFile || !outputFile) {
      return reject(new Error("❌ Missing file path!"));
    }

    // console.log("🎬 Input video:", videoFile);
    // console.log("🖼️ Input image:", imageFile);
    // console.log("📂 Output file:", outputFile);

    ffmpeg(videoFile)
      .input(imageFile)
      .complexFilter([
        {
          filter: "overlay",
          options: { x: "50", y: "50" },
        },
      ])
      .outputOptions(["-pix_fmt yuv420p", "-c:a copy"])
      .save(outputFile)
      .on("end", () => resolve(`✅ Done: ${outputFile}`))
      .on("error", (err) => reject(err));
  });
}

// ---------- REEL ----------
function generateReel({
  imageFile,
  videoFile,
  audioFile,
  titleText,
  descText,
  outputFile,
}) {
  return new Promise(async (resolve, reject) => {
    try {
      const metadata = await ffprobePromise(audioFile);
      const duration = metadata.format.duration || 30;
      const { width: videoWidth } = await getVideoDimensions(videoFile);
      console.log("🎬 Reel width:", videoWidth);
      console.log("🎵 Audio duration:", duration);

      const fontTitle = path.join(process.cwd(), "assests/font/Nirmala-UI.ttf");
      const fontDesc = path.join(process.cwd(), "assests/font/Nirmala-UI.ttf");

      const fontTitleSafe = fs.existsSync(fontTitle)
        ? fontTitle
        : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
      const fontDescSafe = fs.existsSync(fontDesc)
        ? fontDesc
        : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

      const filter = [
        // Scale image to video width, height = 800, add alpha fade
        `[1:v]scale=1080:800,format=rgba,fade=t=in:st=0:d=1:alpha=1,fade=t=out:st=15.05:d=1:alpha=1[img]`,

        // Overlay image at top
        `[0:v][img]overlay=x=0:y=0[bg]`,

        // Title text
        `[bg]drawtext=fontfile='${fontTitleSafe}':text='${titleText}':fontcolor=white:fontsize=50:x='if(lt(t,0.8), -text_w + (60+text_w)*(t/0.8), 60)':y=1190:alpha='if(lt(t,0.8),(t/0.8),1)':shadowcolor=black:shadowx=2:shadowy=2:line_spacing=15[vid1]`,

        // Description text
        `[vid1]drawtext=fontfile='${fontDescSafe}':text='${descText}':fontcolor=yellow:fontsize=36:x='if(lt(t,1.6), -text_w + (60+text_w)*((t-0.8)/0.8), 60)':y=1390:alpha='if(lt(t,1.6),((t-0.8)/0.8),1)':line_spacing=16:shadowcolor=black:shadowx=1:shadowy=1[vid2]`,
      ];

      ffmpeg()
        .input(videoFile)
        .input(imageFile) // [1:v] for overlay
        .input(audioFile)
        .complexFilter(filter)
        .outputOptions([
          "-map [vid2]",
          "-map 2:a?",
          "-c:v libx264",
          "-crf 18",
          "-preset medium",
          "-c:a aac",
          `-t ${Math.round(duration)}`,
        ])
        // .on("start", (cmd) =>
        //   console.log("FFmpeg started (generateReel):", cmd)
        // )
        .on("end", () => {
          console.log("✅ Reel generated:", outputFile);
          resolve();
        })
        .on("error", (err) => {
          console.error("❌ FFmpeg error (generateReel):", err.message || err);
          reject(err);
        })
        .save(outputFile);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------- Generate TTS for news array ----------
async function generateTTS(allNews, outputDir) {
  console.log("🔊 Generating TTS...");

  //const allNews = [...(newsData?.India || []), ...(newsData?.World || [])];

  if (allNews.length === 0) {
    console.warn("⚠️ No news available to generate TTS.");
    return [];
  }

  const audioFiles = [];

  for (let i = 0; i < allNews.length; i++) {
    const item = allNews[i];
    // console.log("item:", item.id + 1);

    const audioPath = path.join(
      outputDir,
      `audio_${item.id + 1}_${item.language}.mp3`
    );
    await sleep(2000 + Math.random() * 3000);
    console.log(`🎙️ Generating audio for News ${item.id + 1}: ${item.title}`);

    try {
      await fetchTTS({
        content: item.description,
        folderPath: audioPath,
      });
    } catch (err) {
      console.warn("Skipping this item due to TTS error:", item.title);
      continue;
    }

    audioFiles.push({
      path: audioPath,
      title: item.title,
      desc: item.description,
    });

    const title = await prepareText(
      item.title || "",
      item.language == "english" ? 40 : item.language == "gujarati" ? 36 : 38
    );
    const description = await prepareText(item.description || "", 50);
    console.log("Description:", title, description);
    var outputVideoFile = path.join(
      outputDir,
      `output_${item.id + 1}_${item.language}.mp4`
    );
    const imgPath = path.join(outputDir, `img${item.id + 1}.png`);

    try {
      // Check if file exists
      await fs.access(imgPath);
      console.log(`✅ Image already exists: ${imgPath}`);
    } catch {
      // File does not exist, generate it
      try {
        await fetchImage(item.title, imgPath);
        console.log(`🖼️ Image generated: ${imgPath}`);
      } catch (err) {
        console.error(
          "❌ Failed to generate image for item:",
          item.title,
          err.message || err
        );
      }
    }
    try {
      await overlayImage({
        videoFile: item.india
          ? path.join(process.cwd(), "assests/REELS/Reel_3.mp4")
          : path.join(process.cwd(), "assests/REELS/Reel_4.mp4"),
        imageFile: imgPath,
        outputFile: outputVideoFile,
      });
    } catch (err) {
      console.error(
        "❌ Failed to generate reel for item:",
        item.title,
        err.message || err
      );
    }
    // console.log("🎬 Output video: 909090", path.join(outputVideoFile));
    sleep(2000 + Math.random() * 3000);

    try {
      await generateReel({
        imageFile: imgPath,
        videoFile: path.join(outputVideoFile),
        audioFile: audioPath,
        titleText: title,
        descText: description,
        outputFile: path.join(
          outputDir,
          `reel_${item.language}${item.id + 1}.mp4`
        ),
      });
    } catch (err) {
      console.error(
        "❌ Failed to generate reel for item:",
        item.title,
        err.message || err
      );
    }
  }

  return audioFiles;
}

function getAllVideos(folderPath, language) {
  if (!fs.existsSync(folderPath)) return [];

  const files = fs.readdirSync(folderPath);

  // Match "reel_{language}{number}.mp4"
  const videoFiles = files.filter((file) => {
    const match = file.match(new RegExp(`^reel_${language}(\\d+)\\.mp4$`, "i"));
    return match !== null;
  });

  // Sort numerically by the number
  videoFiles.sort((a, b) => {
    const numA = parseInt(
      a.match(new RegExp(`^reel_${language}(\\d+)\\.mp4$`, "i"))[1],
      10
    );
    const numB = parseInt(
      b.match(new RegExp(`^reel_${language}(\\d+)\\.mp4$`, "i"))[1],
      10
    );
    return numA - numB;
  });

  return videoFiles.map((file) => path.join(folderPath, file));
}

function checkStreams(file) {
  return new Promise((resolve, reject) => {
    exec(`ffprobe -v error -show_streams -of json "${file}"`, (err, stdout) => {
      if (err) return reject(err);

      const info = JSON.parse(stdout);
      const hasVideo = info.streams.some((s) => s.codec_type === "video");
      const hasAudio = info.streams.some((s) => s.codec_type === "audio");

      resolve({ file, hasVideo, hasAudio });
    });
  });
}

async function validateVideos(videoFiles) {
  const results = await Promise.all(videoFiles.map(checkStreams));
  results.forEach(({ file, hasVideo, hasAudio }) => {
    // console.log(`${file} → video:${hasVideo}, audio:${hasAudio}`);
  });

  return results;
}

async function mergeVideos(videoFiles, outputFile) {
  const results = await validateVideos(videoFiles);

  const broken = results.filter((r) => !r.hasAudio);
  if (broken.length > 0) {
    console.warn(
      "⚠️ These files have no audio:",
      broken.map((b) => b.file)
    );
    // Option A: fix them by adding silent audio before merge
    // Option B: merge only video (`a:0`)
  }

  return new Promise((resolve, reject) => {
    if (!Array.isArray(videoFiles) || videoFiles.length === 0) {
      return reject(new Error("No videos provided to merge."));
    }

    const ff = ffmpeg();

    videoFiles.forEach((file) => ff.input(file));

    ff.complexFilter([
      {
        filter: "concat",
        options: {
          n: videoFiles.length, // number of input files
          v: 1,
          a: 1,
        },
      },
    ])
      .outputOptions([
        "-y",
        "-c:v libx264",
        "-crf 23",
        "-preset veryfast",
        "-c:a aac",
        "-b:a 192k",
        "-ac 2",
        "-ar 44100",
      ])
      // .on("start", (cmd) => console.log("FFmpeg started (merge):", cmd))
      .on("end", () => {
        console.log("✅ Videos merged:", outputFile);
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ FFmpeg merge error:", err.message || err);
        reject(err);
      })
      .save(outputFile);
  });
}

// ---------- MAIN ----------
(async () => {
  console.log("🚀 Starting news reel automation...");

  try {
    const date = getYesterday();
    console.log("📅 Date:", date);
    const outputDir = getOutputDirForDate(date);
    let { safeParsed, youtubeSEO } = await getNews(date);

    var newsORG = {
      ...safeParsed,
      ...youtubeSEO,
    };

    // Convert object to a formatted string
    const newsText =
      typeof newsORG === "string" ? newsORG : JSON.stringify(newsORG, null, 2);

    // ✅ Ensure outputDir exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // ✅ Write to file
    fs.writeFileSync(
      path.join(outputDir, `news_${date}.txt`),
      newsText,
      "utf-8"
    );

    const allNews = [
      ...(safeParsed?.India || []),
      ...(safeParsed?.World || []),
    ];
    const news = allNews.flatMap((item, index) =>
      Object.entries(item).map(([lang, content]) => ({
        id: index,
        ...content,
        language: lang,
        india: index < 4,
      }))
    );

    // // 1️⃣ Generate TTS and reels
    const audioFiles = await generateTTS(news, outputDir);

    // 2️⃣ Get all generated reels
    ["gujarati", "hindi", "english"].forEach(async (lang) => {
      const videos = getAllVideos(outputDir, lang);
      console.log("All generated videos in output dir:", videos);

      // 3️⃣ Merge with intro/outro
      const allVideos = [
        path.join(process.cwd(), "assests/REELS/Reel_1.mp4"),
        // path.join(process.cwd(), "assests/REELS/Reel_2.mp4"),
        ...videos,
        path.join(process.cwd(), "assests/REELS/Reel_5.mp4"),
      ].filter((p) => fs.existsSync(p));

      console.log("🎬 Videos to merge:", allVideos);

      if (allVideos.length === 0) {
        throw new Error("No videos to merge - aborting.");
      }

      const finalOutput = path.join(outputDir, `final_${lang}_video.mp4`);
      await mergeVideos(allVideos, finalOutput, lang);
      console.log("🚀 All videos merged into:", finalOutput);
    });
    // 4️⃣ Upload to youtube
    const videoToUpload = await getAllFinalVideosByDate();
    console.log("Videos pushed to youtube:", videoToUpload);
  } catch (err) {
    console.error("Fatal error:", err.message || err);
    process.exitCode = 1;
  }
})();
