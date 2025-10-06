// filename: news-reel-automation.mjs
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import dayjs from "dayjs";

import dotenv from "dotenv";
import sharp from "sharp";

dotenv.config();
import ffmpeg from "fluent-ffmpeg";

let ffmpegPath;

if (
  process.platform === "linux" &&
  (process.arch === "arm64" || process.env.PREFIX?.includes("com.termux"))
) {
  // 🟢 Running inside Termux
  console.log("Detected Termux environment — using system ffmpeg");
  ffmpegPath = "ffmpeg"; // use built-in binary from pkg install ffmpeg
} else {
  // 💻 Running on desktop/server
  const { default: staticPath } = await import("ffmpeg-static");
  ffmpegPath = staticPath;
}

ffmpeg.setFfmpegPath(ffmpegPath);
console.log("FFmpeg path:", ffmpegPath);

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

const generateFolderFile = async (folder, safeTitle, content) => {
  const folderPath = path.resolve(folder);
  const filePath = path.join(folderPath, `${safeTitle}.txt`);

  try {
    // Create nested folder structure if not exists
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true }); // ✅ allows "a/b/c"
    }

    fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf8");
    console.log(`✅ Content saved to: ${filePath}`);
    return true;
  } catch (error) {
    console.error("❌ Error writing file:", error);
    return false;
  }
};

// ---------- CONFIG ----------

// const voice = "ballad";
// const vibe = {
//   voice:
//     "Clear, professional, and authoritative, with a confident newsroom cadence.",
//   punctuation:
//     "Crisp and deliberate, with short pauses for emphasis, mirroring live TV news delivery.",
//   delivery:
//     "Energetic yet controlled, keeping a steady pace that conveys urgency without sounding rushed.",
//   phrasing:
//     "Concise and impactful, structured like broadcast headlines, ensuring each sentence lands strongly.",
//   tone: "Neutral but engaging, balancing seriousness with approachability — like a trusted anchor delivering important updates.",
// };

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

  const prompt = () =>
    `You are a professional journalist. Summarize the **major key news events** for the date ${date}.
Return the response strictly as a **valid JSON object** with the following structure:
{
  "India": [
    {
      "title": "English Title should be 40 - 50 Characters, specific and descriptive of the event",
      "title_hindi": "हिंदी शीर्षक should be 40 - 50 Characters, specific and descriptive of the event",
      "title_gujarati": "should be 40 - 50 Characters, specific and descriptive of the event in Gujarati",
      india:true,
      "description_speech": "A detailed, natural Hindi description of the event in 150 characters, including context and significance",
      "description_display": "A detailed, natural English description of the event in 150 characters, specifying context and impact"
      "description_gujarati": "A detailed, natural Gujarati description of the event in 150 characters, specifying context and impact"
    }
  ],
  "World": [
    {
      "title": "English Title should be 40 - 50 Characters, specific and descriptive of the event",
      "title_hindi": "हिंदी शीर्षक should be 40 - 50 Characters, specific and descriptive of the event",
      "title_gujarati": "should be 40 - 50 Characters, specific and descriptive of the event in Gujarati",
      india:true,
      "description_speech": "A detailed, natural Hindi description of the event in 150 characters, including context and significance",
      "description_display": "A detailed, natural English description of the event in 150 characters, specifying context and impact"
      "description_gujarati": "A detailed, natural Gujarati description of the event in 150 characters, specifying context and impact"
    }
  ]
}
### Requirements:
- Provide **4–6 major events** in each section ("India" and "World").
- Insert **"वीडियो पसंद आए तो लाइक करें, शेयर करें और चैनल सब्सक्राइब करना न भूलें।"** at the end of **only one** description_speech (either in India or World section).
- Make sure **titles** and **description_display** **do not include apostrophes or possessives** ('s).
- Each **title** must be concise, specific, and in **English only**.
- Each **title_hindi** must be concise, specific, and in **Hindi only**, you can add commonly speaking English words.
- Each **title_gujarati** must be concise, specific, and in **Gujarati only**, you can add commonly speaking English words.
- Each **description_speech** must be **natural, clear, and detailed in Hindi**, giving context, significance, and any impact.
- Each **description_display** must be **natural, clear, and detailed in English**, giving context, significance, and any impact.
- Each **description_gujarati** must be **natural, clear, and detailed in Gujarati**, giving context, significance, and any impact.
- Each **image_url** must be a valid URL of a relevant, high-quality image for the news event.
- Avoid generic wording; titles should indicate the main point of the news event clearly.
- Return the response strictly as **raw JSON only** with no markdown, comments, backticks, or extra text.
`;

  for (let attempt = 0; attempt < models.length; attempt++) {
    const modelName = models[attempt];
    try {
      console.log(`🔄 Attempt ${attempt + 1} with model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });

      const res = await model.generateContent(await prompt());

      // ✅ Extract raw text
      const text = res?.response?.text ? res.response.text().trim() : "";
      // Convert object to a formatted string

      generateFolderFile(
        `./output/${date}`,
        `news_${date}`,
        JSON.stringify(text, null, 2)
      );

      // Write to file
      // fs.writeFileSync(`news_${date}.txt`, newsText, "utf-8");

      console.log("✅ Gemini raw output:", text);

      // ✅ Parse JSON safely
      let parsed;
      try {
        const cleaned = cleanGeminiJSON(text);
        parsed = JSON.parse(cleaned);
      } catch (e) {
        throw new Error("Gemini returned invalid JSON: " + text.slice(0, 200));
      }

      // ✅ Always return arrays
      const safeParsed = {
        India: Array.isArray(parsed.India) ? parsed.India : [],
        World: Array.isArray(parsed.World) ? parsed.World : [],
      };

      // ✅ Stop retrying if we got valid news
      if (safeParsed.India.length > 0 || safeParsed.World.length > 0) {
        console.log(
          `✅ Got ${safeParsed.India.length} India news & ${safeParsed.World.length} World news`
        );
        return safeParsed;
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
        console.log(`   🏷️ ${ariaLabel}`);
        console.log(`   📷 ${cleanUrl}`);
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
  console.log("🎬 Input video:", videoFile);
  console.log("🖼️ Input image:", imageFile);
  console.log("📂 Output file:", outputFile);

  return new Promise((resolve, reject) => {
    if (!videoFile || !imageFile || !outputFile) {
      return reject(new Error("❌ Missing file path!"));
    }

    console.log("🎬 Input video:", videoFile);
    console.log("🖼️ Input image:", imageFile);
    console.log("📂 Output file:", outputFile);

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

      const fontTitle = path.join(
        process.cwd(),
        "assests/font/Antonio-Bold.ttf"
      );
      const fontDesc = path.join(process.cwd(), "assests/font/Garet-Book.ttf");

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
        `[bg]drawtext=fontfile='${fontTitleSafe}':text='${titleText}':fontcolor=white:fontsize=60:x='if(lt(t,0.8), -text_w + (60+text_w)*(t/0.8), 60)':y=1190:alpha='if(lt(t,0.8),(t/0.8),1)':shadowcolor=black:shadowx=2:shadowy=2:line_spacing=15[vid1]`,

        // Description text
        `[vid1]drawtext=fontfile='${fontDescSafe}':text='${descText}':fontcolor=yellow:fontsize=40:x='if(lt(t,1.6), -text_w + (60+text_w)*((t-0.8)/0.8), 60)':y=1390:alpha='if(lt(t,1.6),((t-0.8)/0.8),1)':line_spacing=16:shadowcolor=black:shadowx=1:shadowy=1[vid2]`,
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
        .on("start", (cmd) =>
          console.log("FFmpeg started (generateReel):", cmd)
        )
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
async function generateTTS(newsData, outputDir) {
  console.log("🔊 Generating TTS...");

  const allNews = [...(newsData?.India || []), ...(newsData?.World || [])];

  if (allNews.length === 0) {
    console.warn("⚠️ No news available to generate TTS.");
    return [];
  }

  const audioFiles = [];

  for (let i = 0; i < allNews.length; i++) {
    const item = allNews[i];
    const audioPath = path.join(outputDir, `audio${i + 1}.mp3`);
    await sleep(2000 + Math.random() * 3000);
    console.log(`🎙️ Generating audio for News ${i + 1}: ${item.title}`);

    try {
      await fetchTTS({
        content: item.description_speech,
        folderPath: audioPath,
      });
    } catch (err) {
      console.warn("Skipping this item due to TTS error:", item.title);
      continue;
    }

    audioFiles.push({
      path: audioPath,
      title: item.title_hindi || item.title,
      desc: item.description_speech,
    });

    const title = await prepareText(item.title || "", 40);
    const description = await prepareText(item.description_display || "", 42);
    console.log("Description:", description);
    var outputVideoFile = path.join(outputDir, `output_${i + 1}.mp4`);
    const imgPath = path.join(outputDir, `img${i + 1}.png`);

    try {
      await fetchImage(item.title, imgPath);
    } catch {
      console.error(
        "❌ Failed to generate reel for item:",
        item.title,
        err.message || err
      );
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
    console.log("🎬 Output video: 909090", path.join(outputVideoFile));
    sleep(2000 + Math.random() * 3000);

    try {
      await generateReel({
        imageFile: imgPath,
        videoFile: path.join(outputVideoFile),
        audioFile: audioPath,
        titleText: title,
        descText: description,
        outputFile: path.join(outputDir, `reel${i + 1}.mp4`),
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

function getAllVideos(folderPath) {
  if (!fs.existsSync(folderPath)) return [];

  const files = fs.readdirSync(folderPath);

  // ✅ Only match "ree{number}.mp4"
  const videoFiles = files.filter((file) => /^reel\d+\.mp4$/i.test(file));

  // ✅ Sort numerically by the number after "ree"
  videoFiles.sort((a, b) => {
    const numA = parseInt(a.match(/^reel(\d+)\.mp4$/i)[1], 10);
    const numB = parseInt(b.match(/^reel(\d+)\.mp4$/i)[1], 10);
    return numA - numB;
  });

  return videoFiles.map((file) => path.join(folderPath, file));
}

function mergeVideos(videoFiles, outputFile) {
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
      .on("start", (cmd) => console.log("FFmpeg started (merge):", cmd))
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
    let news = await getNews(date);
    // let news = {
    //   India: [
    //     {
    //       title: "Trump's $100K H-1B Fee Hits Indian IT Firms Hard",
    //       title_hindi: "ट्रम्प का $100K H-1B शुल्क भारतीय आईटी प्रभावित",
    //       title_gujarati: "ટ્રમ્પનું $100K H-1B ફી ભારતીય આઈટી પર અસર",
    //       india: true,
    //       description_speech:
    //         "ट्रम्प की नई नीति में H-1B वीज़ा शुल्क $100K हुआ, जिससे भारतीय IT शेयरों और रोजगार पर गंभीर असर पड़ा।",
    //       description_display:
    //         "Trump's $100K H-1B fee hits Indian IT stocks and may impact employment and sector growth.",
    //       description_gujarati:
    //         "ટ્રમ્પની નીતિ મુજબ H-1B વિઝા પર $100K ફી લાગુ, ભારતીય IT શેર અને રોજગારી પર અસર.",
    //     },
    //     {
    //       title: "Indian IT Stocks Fall on U.S. Visa Fee Hike",
    //       title_hindi:
    //         "भारतीय IT शेयरों में अमेरिकी वीज़ा शुल्क बढ़ोतरी से गिरावट",
    //       title_gujarati: "અમેરિકન વિઝા ફી વધારાથી ભારતીય IT શેરમાં ઘટાડો",
    //       india: true,
    //       description_speech:
    //         "H-1B वीज़ा शुल्क बढ़ोतरी के बाद Infosys, Wipro और TCS के शेयरों में तेज गिरावट आई।",
    //       description_display:
    //         "U.S. H-1B fee hike causes sharp declines in Indian IT stocks like Infosys and Wipro.",
    //       description_gujarati:
    //         "H-1B ફી વધારાના પગલે ઇન્ફોસિસ, વિપ્રો અને TCS શેરોમાં ઘટાડો થયો.",
    //     },
    //     {
    //       title: "Telangana MPs Demand Action on H-1B Fee Impact",
    //       title_hindi: "तेलंगाना सांसदों ने H-1B शुल्क पर कार्रवाई मांगी",
    //       title_gujarati: "તેલંગાણા સાંસદોએ H-1B ફી પર કાર્યવાહી માંગ્યો",
    //       india: true,
    //       description_speech:
    //         "सांसदों ने केंद्र से H-1B शुल्क वृद्धि के प्रभावों पर ध्यान देने और उपाय करने की अपील की।",
    //       description_display:
    //         "Telangana MPs urge Indian government to address H-1B visa fee hike impact on IT professionals.",
    //       description_gujarati:
    //         "સાંસદોએ ભારતીય સરકારને H-1B ફી વધારાના પ્રભાવ માટે પગલાં લેવા કહ્યું.",
    //     },
    //     {
    //       title: "Nasscom Welcomes Clarification on H-1B Fees",
    //       title_hindi: "Nasscom ने H-1B शुल्क स्पष्टिकरण का स्वागत किया",
    //       title_gujarati: "Nasscomએ H-1B ફી સ્પષ્ટીકરણનો સ્વાગત કર્યું",
    //       india: true,
    //       description_speech:
    //         "Nasscom ने बताया कि नए शुल्क केवल नए H-1B आवेदनों पर लागू होंगे, इससे आईटी कंपनियों को राहत मिली।",
    //       description_display:
    //         "Nasscom welcomes U.S. clarification that $100K H-1B fee applies only to new applications, easing IT concerns.",
    //       description_gujarati:
    //         "Nasscomએ કહ્યું કે નવા ફી માત્ર નવા H-1B અરજીઓ માટે લાગુ, IT ક્ષેત્રને રાહત મળી.",
    //     },
    //   ],
    //   World: [
    //     {
    //       title: "Trump's H-1B Fee May Cost US Firms $14 Billion",
    //       title_hindi:
    //         "ट्रम्प के H-1B शुल्क से अमेरिकी कंपनियों पर 14 अरब खर्च",
    //       title_gujarati: "ટ્રમ્પની H-1B ફી US કંપનીઓ માટે $14 બિલિયન ખર્ચ",
    //       india: true,
    //       description_speech:
    //         "H-1B वीज़ा शुल्क $100K बढ़ोतरी से अमेरिकी कंपनियों पर 14 अरब डॉलर का असर पड़ेगा।",
    //       description_display:
    //         "$100K H-1B fee may cost U.S. companies $14 billion annually, affecting hiring strategies.",
    //       description_gujarati:
    //         "H-1B વિઝા ફી $100K વધારાથી US કંપનીઓ પર $14 બિલિયન ખર્ચ પડશે.",
    //     },
    //     {
    //       title: "White House Justifies H-1B Fee Hike Amid Criticism",
    //       title_hindi:
    //         "व्हाइट हाउस ने आलोचना के बीच H-1B शुल्क बढ़ोतरी का समर्थन किया",
    //       title_gujarati: "વ્હાઇટ હાઉસે H-1B ફી વધારાને સમર્થન આપ્યું",
    //       india: true,
    //       description_speech:
    //         "व्हाइट हाउस ने कहा कि H-1B वीज़ा शुल्क बढ़ोतरी से अमेरिकी कर्मचारियों की सुरक्षा सुनिश्चित होगी।",
    //       description_display:
    //         "White House defends H-1B fee hike as a measure to protect American workers.",
    //       description_gujarati:
    //         "વ્હાઇટ હાઉસે કહ્યું કે H-1B ફી વધારાથી અમેરિકન કર્મચારીઓની સુરક્ષા થશે.",
    //     },
    //     {
    //       title: "Global Tech Faces Challenges Due to H-1B Fee Rise",
    //       title_hindi: "वैश्विक तकनीकी क्षेत्र H-1B शुल्क वृद्धि से चुनौती में",
    //       title_gujarati: "ગ્લોબલ ટેક H-1B ફી વધારાથી પડકારનો સામનો",
    //       india: true,
    //       description_speech:
    //         "नई H-1B शुल्क नीति से वैश्विक तकनीकी कंपनियों को कुशल विदेशी कर्मचारियों की भर्ती में मुश्किलें।",
    //       description_display:
    //         "New $100K H-1B fee creates challenges for global tech firms hiring skilled foreign workers.",
    //       description_gujarati:
    //         "નવી H-1B ફી વૈશ્વિક ટેક કંપનીઓ માટે કુશળ વિદેશી કર્મચારીઓ ભાડે રાખવામાં પડકાર.",
    //     },
    //     {
    //       title: "Goldman Sachs Advises Caution for H-1B Holders",
    //       title_hindi: "गोल्डमैन सैक्स ने H-1B धारकों को सतर्क रहने की सलाह दी",
    //       title_gujarati: "ગોલ્ડમેન સૅક્સે H-1B ધારકોને સાવધાન રહેવાની સલાહ",
    //       india: true,
    //       description_speech:
    //         "गोल्डमैन सैक्स ने H-1B वीज़ा धारकों को अंतरराष्ट्रीय यात्रा में सावधानी बरतने की चेतावनी दी।",
    //       description_display:
    //         "Goldman Sachs advises H-1B visa holders to exercise caution during international travel amid policy uncertainty.",
    //       description_gujarati:
    //         "ગોલ્ડમેન સૅક્સે H-1B વિઝા ધારકોને આંતરરાષ્ટ્રીય મુસાફરીમાં સાવધાન રહેવાની સલાહ આપી.",
    //     },
    //   ],
    // };

    // // 1️⃣ Generate TTS and reels
    const audioFiles = await generateTTS(news, outputDir);
    console.log(
      "Generated audio files:",
      audioFiles.map((a) => a.path)
    );

    // 2️⃣ Get all generated reels
    const videos = getAllVideos(outputDir);
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

    const finalOutput = path.join(outputDir, "final_video.mp4");
    await mergeVideos(allVideos, finalOutput);

    console.log("🚀 All videos merged into:", finalOutput);
  } catch (err) {
    console.error("Fatal error:", err.message || err);
    process.exitCode = 1;
  }
})();
