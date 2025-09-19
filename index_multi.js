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

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);

// ---------- UTILS ----------
function getYesterday() {
  return dayjs().subtract(1, "day").format("YYYY-MM-DD");
  // return dayjs().format("YYYY-MM-DD");
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
const voice = "nova";
const vibe = {
  Voice:
    "faster-paced, Clear, professional, and authoritative, with a confident newsroom cadence.",
  Tone: "Neutral yet engaging, balancing seriousness with approachability — like a trusted anchor delivering important updates.",
  Delivery:
    "Energetic yet controlled, with a steady pace that conveys urgency without sounding rushed.",
  Pronunciation:
    "Crisp and deliberate, with emphasis on numbers, names, and key facts to ensure clarity.",
  Phrasing:
    "Concise and impactful, structured like broadcast headlines, ensuring each sentence lands strongly.",
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
    `You are a professional multilingual journalist specializing in analysis.
Your task is to prepare a "Daily Knowledge Bulletin" of ${date} in valid JSON format.

The JSON must strictly follow this structure and be returned as a single valid JSON object only:

{
  "title": "Generic headline for the bulletin with some hashtags, date, and 'With In 24 Hours News'",
  "tags": "SEO-friendly, keyword-rich tags (approx. 250 characters, comma-separated) related to the news",
  "hashtags": "SEO-friendly, keyword-rich hashtags (comma-separated) related to the news",
  "India": [
    {
      "english": {
        "title": "Factual headline here",
        "description": "2–3 sentence summary of the event or development.",
        "why_it_matters": "Concise analysis of long-term impact (geopolitical, economic, scientific)."
      },
      "hindi": {
        "title": "हिन्दी शीर्षक यहाँ (लगभग 65 अक्षरों वाला वाक्य)"
        "description": "घटना या विकास का 2–3 वाक्य का सारांश।",
        "why_it_matters": "दीर्घकालिक प्रभाव का संक्षिप्त विश्लेषण।"
      },
      "gujarati": {
        "title": "ગુજરાતી શીર્ષક અહીં (65 અક્ષર આસપાસના વાક્યો)",
        "description": "ઘટના અથવા વિકાસનો 2–3 વાક્યનો સારાંશ.",
        "why_it_matters": "દીર્ધકાળીન અસરનું સંક્ષિપ્ત વિશ્લેષણ."
      },
      "india": true
    }
    /* Repeat 4–6 such objects in the "India" array (total 4–6 India items). Each India item must include "india": true. */
  ],
  "World": [
    {
      "english": {
        "title": "Factual headline here",
        "description": "2–3 sentence summary of the event or development.",
        "why_it_matters": "Concise analysis of long-term impact (geopolitical, economic, scientific)."
      },
      "hindi": {
        "title": "हिंदी शीर्षक यहाँ",
        "description": "घटना या विकास का 2–3 वाक्य का सारांश।",
        "why_it_matters": "दीर्घकालिक प्रभाव का संक्षिप्त विश्लेषण।"
      },
      "gujarati": {
        "title": "ગુજરાતી શીર્ષક અહીં",
        "description": "ઘટના અથવા વિકાસનો 2–3 વાક્યનો સારાંશ.",
        "why_it_matters": "દીર્ધકાળીન અસરનું સંક્ષિપ્ત વિશ્લેષણ."
      }
    }
    /* Repeat 4–6 such objects in the "World" array (total 4–6 World items). */
  ]
}

Requirements:
1. Provide 4–6 major key events that matter to an Indian audience in each section ("India" and "World").
2. Coverage must include policy, economy, environment, science, technology, health, defence, and international relations across the items.
3. Exclude entertainment, celebrity, and sports content.
4. Ensure all fields are fully translated into English, Hindi, and Gujarati.
5. Return the final response as a single valid JSON object only, with no extra commentary or text outside the JSON.

Notes for the generator:
- Each news item must be factual-sounding and concise (title: 8–16 words; description: 2–3 sentences; why_it_matters: 1–2 sentences).
- For India items include the key "india": true at the item root.
- make sure no apostrophes are included in any field of the output.
- Do not include comments or sample placeholders in the final JSON output; the comments above are only for prompt clarity.
`;

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
      const duration = metadata.format.duration || 10;
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
    console.log("item:", item.id + 1);

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
      item.language == "english" ? 40 : item.language == "gujarati" ? 32 : 36
    );
    const description = await prepareText(item.description || "", 46);
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
    console.log("🎬 Output video: 909090", path.join(outputVideoFile));
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
    console.log(`${file} → video:${hasVideo}, audio:${hasAudio}`);
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
    // let newsORG = await getNews(date);
    // let newsORG = {
    //   India: [
    //     {
    //       english: {
    //         title: "New Agricultural Subsidy Program Launched",
    //         description:
    //           "The Indian government unveiled a new agricultural subsidy program targeting small and marginal farmers.  The program aims to provide direct financial assistance and improve access to technology.",
    //         why_it_matters:
    //           "This initiative could significantly impact food security and rural incomes, potentially reducing farmer distress and boosting agricultural productivity.  However, successful implementation hinges on efficient distribution and minimizing corruption.",
    //       },
    //       hindi: {
    //         title: "नई कृषि सब्सिडी कार्यक्रम शुरू किया गया",
    //         description:
    //           "भारत सरकार ने छोटे और सीमांत किसानों को लक्षित करते हुए एक नया कृषि सब्सिडी कार्यक्रम शुरू किया है।  इस कार्यक्रम का उद्देश्य प्रत्यक्ष वित्तीय सहायता प्रदान करना और प्रौद्योगिकी तक पहुंच में सुधार करना है।",
    //         why_it_matters:
    //           "यह पहल खाद्य सुरक्षा और ग्रामीण आय को महत्वपूर्ण रूप से प्रभावित कर सकती है, संभावित रूप से किसानों की परेशानी को कम कर सकती है और कृषि उत्पादकता को बढ़ावा दे सकती है। हालांकि, सफल कार्यान्वयन कुशल वितरण और भ्रष्टाचार को कम करने पर निर्भर करता है।",
    //       },
    //       gujarati: {
    //         title: "નવી કૃષિ સબસિડી યોજના શરૂ કરવામાં આવી",
    //         description:
    //           "ભારત સરકારે નાના અને સીમાંત ખેડૂતોને લક્ષ્યાંકિત કરતી એક નવી કૃષિ સબસિડી યોજના શરૂ કરી છે.  આ યોજનાનો ઉદ્દેશ્ય સીધી નાણાકીય સહાય પૂરી પાડવાનો અને ટેકનોલોજીની ઍક્સેસમાં સુધારો કરવાનો છે.",
    //         why_it_matters:
    //           "આ પહેલ ખાદ્ય સુરક્ષા અને ગ્રામીણ આવકને નોંધપાત્ર રીતે અસર કરી શકે છે, સંભવતઃ ખેડૂતોની મુશ્કેલીઓ ઓછી કરી શકે છે અને કૃષિ ઉત્પાદકતામાં વધારો કરી શકે છે. જો કે, સફળ અમલીકરણ કાર્યક્ષમ વિતરણ અને ભ્રષ્ટાચાર ઘટાડવા પર આધારિત છે.",
    //       },
    //     },
    //     {
    //       english: {
    //         title: "India's Chandrayaan-3 Mission Data Analysis Begins",
    //         description:
    //           "Scientists have begun analyzing the extensive data collected by the Chandrayaan-3 lunar rover.  Initial findings are expected to shed light on the moon's geological composition and water ice presence.",
    //         why_it_matters:
    //           "This data will significantly advance our understanding of lunar geology and the potential for future lunar exploration and resource utilization, including potential water ice extraction for future missions.",
    //       },
    //       hindi: {
    //         title: "भारत के चंद्रयान-3 मिशन डेटा विश्लेषण शुरू",
    //         description:
    //           "वैज्ञानिकों ने चंद्रयान-3 चंद्र रोवर द्वारा एकत्रित व्यापक डेटा का विश्लेषण शुरू कर दिया है। प्रारंभिक निष्कर्षों से चंद्रमा की भूवैज्ञानिक संरचना और जल बर्फ की उपस्थिति पर प्रकाश पड़ने की उम्मीद है।",
    //         why_it_matters:
    //           "यह डेटा चंद्रमा के भूविज्ञान और भविष्य के चंद्र अन्वेषण और संसाधन उपयोग, जिसमें भविष्य के मिशनों के लिए संभावित जल बर्फ निष्कर्षण शामिल है, की हमारी समझ को काफी आगे बढ़ाएगा।",
    //       },
    //       gujarati: {
    //         title: "ભારતના ચંદ્રયાન-3 મિશન ડેટાનું વિશ્લેષણ શરૂ",
    //         description:
    //           "વૈજ્ઞાનિકોએ ચંદ્રયાન-3 ચંદ્ર રોવર દ્વારા એકત્રિત કરવામાં આવેલા વિશાળ ડેટાનું વિશ્લેષણ શરૂ કર્યું છે. પ્રારંભિક તારણો ચંદ્રની ભૂસ્તરશાસ્ત્રીય રચના અને પાણીના બરફની હાજરી પર પ્રકાશ પાડશે.",
    //         why_it_matters:
    //           "આ ડેટા ચંદ્ર ભૂસ્તરશાસ્ત્ર અને ભવિષ્યના ચંદ્ર અન્વેષણ અને સંસાધન ઉપયોગ, જેમાં ભવિષ્યના મિશન માટે સંભવિત પાણીના બરફના નિષ્કર્ષણનો સમાવેશ થાય છે, તેના વિશેની આપણી સમજને નોંધપાત્ર રીતે આગળ વધારશે.",
    //       },
    //     },
    //     {
    //       english: {
    //         title: "New Digital Public Infrastructure Bill Introduced",
    //         description:
    //           "Parliament introduced a new bill aimed at establishing a robust digital public infrastructure for various government services.  The bill focuses on data security and interoperability.",
    //         why_it_matters:
    //           "This could significantly improve the efficiency and accessibility of government services, promoting digital inclusion and potentially streamlining bureaucratic processes.  However, concerns about data privacy and potential misuse need careful consideration.",
    //       },
    //       hindi: {
    //         title: "नया डिजिटल सार्वजनिक बुनियादी ढांचा विधेयक पेश किया गया",
    //         description:
    //           "संसद ने विभिन्न सरकारी सेवाओं के लिए एक मजबूत डिजिटल सार्वजनिक बुनियादी ढांचा स्थापित करने के उद्देश्य से एक नया विधेयक पेश किया है। यह विधेयक डेटा सुरक्षा और अंतःक्रियाशीलता पर केंद्रित है।",
    //         why_it_matters:
    //           "यह सरकारी सेवाओं की दक्षता और सुलभता में उल्लेखनीय सुधार कर सकता है, डिजिटल समावेशन को बढ़ावा दे सकता है और संभावित रूप से नौकरशाही प्रक्रियाओं को सुव्यवस्थित कर सकता है। हालांकि, डेटा गोपनीयता और संभावित दुरुपयोग के बारे में चिंताओं पर सावधानीपूर्वक विचार करने की आवश्यकता है।",
    //       },
    //       gujarati: {
    //         title: "નવી ડિજિટલ જાહેર ઈન્ફ્રાસ્ટ્રક્ચર બિલ રજૂ કરવામાં આવ્યું",
    //         description:
    //           "સંસદે વિવિધ સરકારી સેવાઓ માટે મજબૂત ડિજિટલ જાહેર ઈન્ફ્રાસ્ટ્રક્ચર સ્થાપિત કરવાના ઉદ્દેશ્યથી એક નવું બિલ રજૂ કર્યું છે. આ બિલ ડેટા સુરક્ષા અને ઇન્ટરઓપરેબિલિટી પર કેન્દ્રિત છે.",
    //         why_it_matters:
    //           "આ સરકારી સેવાઓની કાર્યક્ષમતા અને સુલભતામાં નોંધપાત્ર સુધારો કરી શકે છે, ડિજિટલ સમાવેશને પ્રોત્સાહન આપી શકે છે અને સંભવિત રીતે નોકરશાહી પ્રક્રિયાઓને સુव्यवस्थित કરી શકે છે. જો કે, ડેટા ગોપનીયતા અને સંભવિત દુરુપયોગ વિશેની ચિંતાઓ પર કાળજીપૂર્વક વિચાર કરવાની જરૂર છે.",
    //       },
    //     },
    //     {
    //       english: {
    //         title: "Monsoon Rainfall Impacts Agricultural Output",
    //         description:
    //           "Irregular monsoon rainfall patterns have impacted agricultural yields across several states.  Farmers are facing challenges with crop production and potential losses.",
    //         why_it_matters:
    //           "This underscores the vulnerability of India's agricultural sector to climate change and the need for robust drought-resistant crop varieties and effective irrigation infrastructure. Food prices might be affected.",
    //       },
    //       hindi: {
    //         title: "मानसून वर्षा का कृषि उत्पादन पर प्रभाव",
    //         description:
    //           "अनियमित मानसून वर्षा के पैटर्न ने कई राज्यों में कृषि उपज को प्रभावित किया है। किसानों को फसल उत्पादन और संभावित नुकसान के साथ चुनौतियों का सामना करना पड़ रहा है।",
    //         why_it_matters:
    //           "यह जलवायु परिवर्तन के प्रति भारत के कृषि क्षेत्र की भेद्यता और मजबूत सूखा प्रतिरोधी फसल किस्मों और प्रभावी सिंचाई बुनियादी ढांचे की आवश्यकता को रेखांकित करता है। खाद्य कीमतें प्रभावित हो सकती हैं।",
    //       },
    //       gujarati: {
    //         title: "ચોમાસાના વરસાદની કૃષિ ઉત્પાદન પર અસર",
    //         description:
    //           "અનિયમિત ચોમાસાના વરસાદના પેટર્નની ઘણી રાજ્યોમાં કૃષિ ઉત્પાદન પર અસર પડી છે. ખેડૂતોને પાક ઉત્પાદન અને સંભવિત નુકસાન સાથે પડકારોનો સામનો કરવો પડી રહ્યો છે.",
    //         why_it_matters:
    //           "આ ભારતના કૃષિ ક્ષેત્રની આબોહવા પરિવર્તન પ્રત્યેના સંવેદનશીલતા અને મજબૂત દુષ્કાળ-પ્રતિરોધક પાકની જાતો અને અસરકારક સિંચાઈ ઈન્ફ્રાસ્ટ્રક્ચરની જરૂરિયાતને રેખાંકિત કરે છે. ખાદ્ય ભાવો પ્રભાવિત થઈ શકે છે.",
    //       },
    //     },
    //     {
    //       english: {
    //         title:
    //           "Strengthening Cybersecurity Measures for Critical Infrastructure",
    //         description:
    //           "The government announced new initiatives to bolster cybersecurity defenses for critical infrastructure sectors, including power grids and financial institutions.",
    //         why_it_matters:
    //           "Protecting critical infrastructure from cyberattacks is paramount for national security and economic stability.  These measures aim to reduce vulnerabilities and enhance resilience against increasingly sophisticated threats.",
    //       },
    //       hindi: {
    //         title:
    //           "महत्वपूर्ण बुनियादी ढांचे के लिए साइबर सुरक्षा उपायों को मजबूत करना",
    //         description:
    //           "सरकार ने बिजली ग्रिड और वित्तीय संस्थानों सहित महत्वपूर्ण बुनियादी ढांचा क्षेत्रों के लिए साइबर सुरक्षा बचाव को मजबूत करने के लिए नई पहल की घोषणा की है।",
    //         why_it_matters:
    //           "साइबर हमलों से महत्वपूर्ण बुनियादी ढांचे की रक्षा करना राष्ट्रीय सुरक्षा और आर्थिक स्थिरता के लिए सर्वोपरि है। ये उपाय कमजोरियों को कम करने और तेजी से परिष्कृत खतरों के खिलाफ लचीलापन बढ़ाने का लक्ष्य रखते हैं।",
    //       },
    //       gujarati: {
    //         title:
    //           "મહત્વપૂર્ણ ઈન્ફ્રાસ્ટ્રક્ચર માટે સાયબર સુરક્ષા પગલાંને મજબૂત બનાવવા",
    //         description:
    //           "સરકારે વીજ ગ્રીડ અને નાણાકીય સંસ્થાઓ સહિત મહત્વપૂર્ણ ઈન્ફ્રાસ્ટ્રક્ચર ક્ષેત્રો માટે સાયબર સુરક્ષા સુરક્ષાને મજબૂત બનાવવા માટે નવી પહેલોની જાહેરાત કરી છે.",
    //         why_it_matters:
    //           "સાયબર હુમલાઓથી મહત્વપૂર્ણ ઈન્ફ્રાસ્ટ્રક્ચરનું રક્ષણ રાષ્ટ્રીય સુરક્ષા અને આર્થિક સ્થિરતા માટે અત્યંત મહત્વનું છે. આ પગલાંનો ઉદ્દેશ્ય સંવેદનશીલતા ઘટાડવા અને વધુને વધુ ગૂંચવણભર્યા ખતરાઓ સામે લવચીકતા વધારવાનો છે.",
    //       },
    //     },
    //   ],
    //   World: [
    //     {
    //       english: {
    //         title: "Global Inflation Remains a Concern",
    //         description:
    //           "Persistent inflation continues to challenge many global economies.  Central banks are grappling with balancing economic growth and price stability.",
    //         why_it_matters:
    //           "High inflation erodes purchasing power, potentially leading to social unrest and hindering economic growth.  The global economy's future trajectory significantly depends on effective inflation management.",
    //       },
    //       hindi: {
    //         title: "वैश्विक मुद्रास्फीति एक चिंता का विषय बनी हुई है",
    //         description:
    //           "लगातार मुद्रास्फीति कई वैश्विक अर्थव्यवस्थाओं के लिए चुनौती बनी हुई है। केंद्रीय बैंक आर्थिक विकास और मूल्य स्थिरता के बीच संतुलन बनाने से जूझ रहे हैं।",
    //         why_it_matters:
    //           "उच्च मुद्रास्फीति क्रय शक्ति को कम करती है, जिससे सामाजिक अशांति हो सकती है और आर्थिक विकास में बाधा उत्पन्न हो सकती है। वैश्विक अर्थव्यवस्था का भविष्य का मार्ग प्रभावी मुद्रास्फीति प्रबंधन पर महत्वपूर्ण रूप से निर्भर करता है।",
    //       },
    //       gujarati: {
    //         title: "વૈશ્વિક ફુગાવો ચિંતાનો વિષય રહ્યો",
    //         description:
    //           "ચાલુ ફુગાવો ઘણી વૈશ્વિક અર્થવ્યવસ્થાઓ માટે પડકાર રહ્યો છે. કેન્દ્રીય બેંકો આર્થિક વિકાસ અને ભાવ સ્થિરતા વચ્ચે સંતુલન બનાવવા માટે સંઘર્ષ કરી રહી છે.",
    //         why_it_matters:
    //           "ઉચ્ચ ફુગાવાથી ખરીદ શક્તિ ઓછી થાય છે, જેનાથી સામાજિક અશાંતિ થઈ શકે છે અને આર્થિક વિકાસમાં અવરોધ આવી શકે છે. વૈશ્વિક અર્થવ્યવસ્થાનો ભવિષ્યનો માર્ગ અસરકારક ફુગાવાના વ્યવસ્થાપન પર નોંધપાત્ર રીતે નિર્ભર છે.",
    //       },
    //     },
    //     {
    //       english: {
    //         title: "EU Energy Policy Adjustments",
    //         description:
    //           "The European Union announced adjustments to its energy policy in response to the ongoing energy crisis.  The focus is on diversifying energy sources and improving energy efficiency.",
    //         why_it_matters:
    //           "This policy shift reflects the EU's efforts to enhance energy security and reduce its dependence on specific energy suppliers.  The long-term implications for global energy markets remain to be seen.",
    //       },
    //       hindi: {
    //         title: "ईयू ऊर्जा नीति समायोजन",
    //         description:
    //           "यूरोपीय संघ ने चल रहे ऊर्जा संकट के जवाब में अपनी ऊर्जा नीति में समायोजन की घोषणा की है। ध्यान ऊर्जा स्रोतों में विविधता लाने और ऊर्जा दक्षता में सुधार पर है।",
    //         why_it_matters:
    //           "यह नीतिगत बदलाव ऊर्जा सुरक्षा बढ़ाने और विशिष्ट ऊर्जा आपूर्तिकर्ताओं पर अपनी निर्भरता कम करने के यूरोपीय संघ के प्रयासों को दर्शाता है। वैश्विक ऊर्जा बाजारों के लिए दीर्घकालिक निहितार्थ अभी देखने बाकी हैं।",
    //       },
    //       gujarati: {
    //         title: "EU ઉર્જા નીતિમાં ગોઠવણો",
    //         description:
    //           "યુરોપિયન યુનિયને ચાલુ ઉર્જા કટોકટીના પ્રતિભાવમાં તેની ઉર્જા નીતિમાં ગોઠવણોની જાહેરાત કરી છે. ધ્યાન ઉર્જાના સ્ત્રોતોમાં વૈવિધ્યકરણ અને ઉર્જા કાર્યક્ષમતામાં સુધારો કરવા પર છે.",
    //         why_it_matters:
    //           "આ નીતિમાં થયેલો ફેરફાર ઉર્જા સુરક્ષા વધારવા અને ચોક્કસ ઉર્જા પુરવઠાકારો પર તેની નિર્ભરતા ઓછી કરવાના EUના પ્રયાસો દર્શાવે છે. વૈશ્વિક ઉર્જા બજારો માટે લાંબા ગાળાના પરિણામો હજુ જોવાના બાકી છે.",
    //       },
    //     },
    //     {
    //       english: {
    //         title: "Advancements in Renewable Energy Technologies",
    //         description:
    //           "Significant breakthroughs in solar panel efficiency and energy storage technologies have been reported.  These advancements are expected to accelerate the global transition to renewable energy.",
    //         why_it_matters:
    //           "The cost reductions and performance improvements in renewable energy technologies are crucial for achieving global climate goals and mitigating the impacts of climate change. This will impact the fossil fuel industry.",
    //       },
    //       hindi: {
    //         title: "नवीकरणीय ऊर्जा प्रौद्योगिकियों में प्रगति",
    //         description:
    //           "सौर पैनल दक्षता और ऊर्जा भंडारण प्रौद्योगिकियों में महत्वपूर्ण सफलताओं की सूचना मिली है। इन प्रगति से नवीकरणीय ऊर्जा में वैश्विक संक्रमण में तेजी आने की उम्मीद है।",
    //         why_it_matters:
    //           "नवीकरणीय ऊर्जा प्रौद्योगिकियों में लागत में कमी और प्रदर्शन में सुधार वैश्विक जलवायु लक्ष्यों को प्राप्त करने और जलवायु परिवर्तन के प्रभावों को कम करने के लिए महत्वपूर्ण हैं। यह जीवाश्म ईंधन उद्योग को प्रभावित करेगा।",
    //       },
    //       gujarati: {
    //         title: "નવીનીકરણીય ઉર્જા ટેકનોલોજીમાં પ્રગતિ",
    //         description:
    //           "સૌર પેનલ કાર્યક્ષમતા અને ઉર્જા સંગ્રહ ટેકનોલોજીમાં નોંધપાત્ર સફળતાઓની જાણ કરવામાં આવી છે. આ પ્રગતિથી નવીનીકરણીય ઉર્જામાં વૈશ્વિક સંક્રમણમાં વેગ આવવાની અપેક્ષા છે.",
    //         why_it_matters:
    //           "નવીનીકરણીય ઉર્જા ટેકનોલોજીમાં ખર્ચમાં ઘટાડો અને કામગીરીમાં સુધારો ગ્લોબલ ક્લાઇમેટ ગોલ્સ હાંસલ કરવા અને આબોહવા પરિવર્તનની અસરોને ઘટાડવા માટે ખૂબ મહત્વપૂર્ણ છે. આ ફોસિલ ફ્યુઅલ ઉદ્યોગને અસર કરશે.",
    //       },
    //     },
    //     {
    //       english: {
    //         title: "International Cooperation on Climate Change",
    //         description:
    //           "Several nations announced increased commitments to reducing greenhouse gas emissions and promoting climate resilience.  New initiatives are being developed for international collaboration.",
    //         why_it_matters:
    //           "Strengthened international cooperation on climate change is crucial for effective mitigation and adaptation strategies.  Success depends on the collective actions and commitments of participating nations.",
    //       },
    //       hindi: {
    //         title: "जलवायु परिवर्तन पर अंतर्राष्ट्रीय सहयोग",
    //         description:
    //           "कई देशों ने ग्रीनहाउस गैस उत्सर्जन को कम करने और जलवायु लचीलापन को बढ़ावा देने के लिए बढ़ी हुई प्रतिबद्धताओं की घोषणा की है। अंतर्राष्ट्रीय सहयोग के लिए नई पहल विकसित की जा रही हैं।",
    //         why_it_matters:
    //           "जलवायु परिवर्तन पर मजबूत अंतर्राष्ट्रीय सहयोग प्रभावी शमन और अनुकूलन रणनीतियों के लिए महत्वपूर्ण है। सफलता भाग लेने वाले देशों के सामूहिक कार्यों और प्रतिबद्धताओं पर निर्भर करती है।",
    //       },
    //       gujarati: {
    //         title: "આબોહવા પરિવર્તન પર આંતરરાષ્ટ્રીય સહયોગ",
    //         description:
    //           "ઘણા દેશોએ ગ્રીનહાઉસ ગેસ ઉત્સર્જન ઘટાડવા અને આબોહવા પ્રતિકારકતાને પ્રોત્સાહન આપવા માટે વધેલી પ્રતિબદ્ધતાઓની જાહેરાત કરી છે. આંતરરાષ્ટ્રીય સહયોગ માટે નવી પહેલો વિકસાવવામાં આવી રહી છે.",
    //         why_it_matters:
    //           "આબોહવા પરિવર્તન પર મજબૂત આંતરરાષ્ટ્રીય સહયોગ અસરકારક શમન અને અનુકૂલન વ્યૂહરચના માટે ખૂબ મહત્વપૂર્ણ છે. સફળતા ભાગ લેતા દેશોની સામૂહિક ક્રિયાઓ અને પ્રતિબદ્ધતા પર નિર્ભર કરે છે.",
    //       },
    //     },
    //     {
    //       english: {
    //         title: "Geopolitical Tensions in the South China Sea",
    //         description:
    //           "Tensions remain high in the South China Sea due to competing territorial claims and maritime disputes.  Diplomatic efforts to de-escalate the situation continue.",
    //         why_it_matters:
    //           "The South China Sea is a crucial maritime route for global trade and resource extraction.  Continued tensions could disrupt global supply chains and escalate into larger regional conflicts.",
    //       },
    //       hindi: {
    //         title: "दक्षिण चीन सागर में भू-राजनीतिक तनाव",
    //         description:
    //           "प्रतिस्पर्धी क्षेत्रीय दावों और समुद्री विवादों के कारण दक्षिण चीन सागर में तनाव उच्च बना हुआ है। स्थिति को कम करने के लिए राजनयिक प्रयास जारी हैं।",
    //         why_it_matters:
    //           "दक्षिण चीन सागर वैश्विक व्यापार और संसाधन निष्कर्षण के लिए एक महत्वपूर्ण समुद्री मार्ग है। निरंतर तनाव वैश्विक आपूर्ति श्रृंखलाओं को बाधित कर सकता है और बड़े क्षेत्रीय संघर्षों में बढ़ सकता है।",
    //       },
    //       gujarati: {
    //         title: "દક્ષિણ ચાઇના સમુદ્રમાં ભૂ-રાજકીય તણાવ",
    //         description:
    //           "સ્પર્ધાત્મક પ્રાદેશિક દાવાઓ અને દરિયાઈ વિવાદોને કારણે દક્ષિણ ચાઇના સમુદ્રમાં તણાવ ઊંચો રહ્યો છે. પરિસ્થિતિને શાંત કરવા માટે રાજદ્વારી પ્રયાસો ચાલુ છે.",
    //         why_it_matters:
    //           "દક્ષિણ ચાઇના સમુદ્ર વૈશ્વિક વેપાર અને સંસાધન નિષ્કર્ષણ માટે એક મહત્વપૂર્ણ દરિયાઈ માર્ગ છે. ચાલુ તણાવ વૈશ્વિક પુરવઠા શૃંખલાઓને ખલેલ પહોંચાડી શકે છે અને મોટા પ્રાદેશિક સંઘર્ષોમાં વધારો કરી શકે છે.",
    //       },
    //     },
    //   ],
    // };

    // const allNews = [...(newsORG?.India || []), ...(newsORG?.World || [])];
    // const news = allNews.flatMap((item, index) =>
    //   Object.entries(item).map(([lang, content]) => ({
    //     id: index,
    //     ...content,
    //     language: lang,
    //     india: index < 4,
    //   }))
    // );
    // console.log("news", news);

    // // // 1️⃣ Generate TTS and reels
    // const audioFiles = await generateTTS(news, outputDir);
    // console.log(
    //   "Generated audio files:",
    //   audioFiles.map((a) => a.path)
    // );

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
  } catch (err) {
    console.error("Fatal error:", err.message || err);
    process.exitCode = 1;
  }
})();
