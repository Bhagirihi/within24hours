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

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);

// ---------- UTILS ----------
function getYesterday() {
  //return dayjs().subtract(1, "day").format("YYYY-MM-DD");
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
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel
  ? genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
  : null; // defensive

const voice = "ballad";
const vibe = {
  voice:
    "Clear, professional, and authoritative, with a confident newsroom cadence.",
  punctuation:
    "Crisp and deliberate, with short pauses for emphasis, mirroring live TV news delivery.",
  delivery:
    "Energetic yet controlled, keeping a steady pace that conveys urgency without sounding rushed.",
  phrasing:
    "Concise and impactful, structured like broadcast headlines, ensuring each sentence lands strongly.",
  tone: "Neutral but engaging, balancing seriousness with approachability — like a trusted anchor delivering important updates.",
};

// ---------- NEWS (via Gemini) ----------
async function getNews(date) {
  console.log("📰 Fetching news from Gemini for", date, "...");

  if (!model) {
    console.warn(
      "⚠️ Gemini model unavailable in this environment -> using fallback news."
    );
    return { India: [], World: [] };
  }

  //   const prompt = () => `
  // You are a professional journalist. Summarize the **major key news events** for the date ${date}.

  // Return the response strictly as a **valid JSON object** with the following structure:

  // {
  //   "India": [
  //     {
  //       "title": "English Title should be 40 - 50 Characters",
  //       "image_url": "A URL of an image related to this news event from Google or yahoo",
  //       "title_hindi": "हिंदी शीर्षक should be 40 - 50 Characters",
  //       india:true,
  //       "description_speech": "Full detailed description of the event in Hindi should be 150 Characters",
  //       "description_display": "Full detailed description of the event in English should be 150 Characters"
  //     }
  //   ],
  //   "World": [
  //     {
  //       "title": "English Title should be 40 - 50 Characters",
  //      "image_url": "A URL of an image related to this news event from Google or yahoo",
  //       "title_hindi": "हिंदी शीर्षक should be 40 - 50 Characters",
  //       india:false,
  //       "description_speech": "Full detailed description of the event in Hindi should be 150 Characters",
  //       "description_display": "Full detailed description of the event in English should be 150 Characters"
  //     }
  //   ]
  // }

  // ### Requirements:
  // - Provide **4–6 major events** in each section ("India" and "World").
  // - make sure that title and description_display **should not include "'s" **.
  // - Each **title** must be in **English** only.
  // - Each **title_hindi** must be in **Hindi** only.
  // - Each **description_speech** must be entirely in Hindi, detailed, natural, and clear.
  // - Each **description_display** must be entirely in English, detailed, natural, and clear.
  // - Each **image_url** must be a valid URL of a relevant image for the news event (preferably high resolution and related to the news topic).
  // - Do not include markdown, commentary, backticks, or extra text.
  // - Return the response strictly as **raw JSON only**. Do not include markdown fences, comments, or any extra text.
  // `;

  const prompt =
    () => `You are a professional journalist. Summarize the **major key news events** for the date ${date}.
Return the response strictly as a **valid JSON object** with the following structure:
{
  "India": [
    {
      "title": "English Title should be 40 - 50 Characters, specific and descriptive of the event",
      "image_url": "A valid URL of a relevant high-resolution image related to the news event",
      "title_hindi": "हिंदी शीर्षक should be 40 - 50 Characters, specific and descriptive of the event",
      india:true,
      "description_speech": "A detailed, natural Hindi description of the event in 150 characters, including context and significance",
      "description_display": "A detailed, natural English description of the event in 150 characters, specifying context and impact"
    }
  ],
  "World": [
    {
      "title": "English Title should be 40 - 50 Characters, specific and descriptive of the event",
      "image_url": "A valid URL of a relevant high-resolution image related to the news event",
      "title_hindi": "हिंदी शीर्षक should be 40 - 50 Characters, specific and descriptive of the event",
      india:false,
      "description_speech": "A detailed, natural Hindi description of the event in 150 characters, including context and significance",
      "description_display": "A detailed, natural English description of the event in 150 characters, specifying context and impact"
    }
  ]
}
### Requirements:
- Provide **4–6 major events** in each section ("India" and "World").
- Make sure **titles** and **description_display** **do not include apostrophes or possessives** ('s).
- Each **title** must be concise, specific, and in **English only**.
- Each **title_hindi** must be concise, specific, and in **Hindi only**.
- Each **description_speech** must be **natural, clear, and detailed in Hindi**, giving context, significance, and any impact.
- Each **description_display** must be **natural, clear, and detailed in English**, giving context, significance, and any impact.
- Each **image_url** must be a valid URL of a relevant, high-quality image for the news event.
- Avoid generic wording; titles should indicate the main point of the news event clearly.
- Return the response strictly as **raw JSON only** with no markdown, comments, backticks, or extra text.
`;

  try {
    const prompt_gemini = await prompt();
    const res = await model.generateContent(prompt_gemini);

    // ✅ Extract raw text only
    const text = res?.response?.text ? res.response.text().trim() : "";
    console.log("✅ Got Gemini output:", text);

    // ✅ Ensure valid JSON
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

    console.log(
      `✅ Got ${safeParsed.India.length} India news & ${safeParsed.World.length} World news`
    );

    return safeParsed;
  } catch (err) {
    console.error("❌ Failed to fetch/parse Gemini output:", err.message);
    return { India: [], World: [] }; // ✅ fallback safe object
  }
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
  // if (!text) return "";

  // // Escape backslashes and single quotes
  // let safeText = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  // // Split words and wrap
  // const words = safeText.split(/\s+/);
  // let lines = [];
  // let current = "";

  // for (const word of words) {
  //   if ((current + " " + word).trim().length > maxLineLength) {
  //     lines.push(current.trim());
  //     current = word;
  //   } else {
  //     current += " " + word;
  //   }
  // }
  // if (current) lines.push(current.trim());

  // // Join with \\n for FFmpeg multiline
  // return lines.join("\\n");
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

// function mergeVideos(videoFiles, outputFile) {
//   return new Promise((resolve, reject) => {
//     if (!Array.isArray(videoFiles) || videoFiles.length === 0) {
//       return reject(new Error("No videos provided to merge."));
//     }

//     const listFile = path.join(process.cwd(), "video_list.txt");
//     const fileContent = videoFiles
//       .map((f) => `file '${path.resolve(f)}'`)
//       .join("\n");
//     fs.writeFileSync(listFile, fileContent);

//     ffmpeg()
//       .input(listFile)
//       .inputOptions(["-f concat", "-safe 0"])
//       .outputOptions([
//         "-y",
//         "-c:v libx264", // ✅ re-encode video
//         "-crf 23", // quality (lower = better, 18–28 range)
//         "-preset veryfast",
//         "-c:a aac", // encode audio
//         "-b:a 192k",
//         "-ac 2",
//         "-ar 44100",
//       ])

//       .on("start", (cmd) => console.log("FFmpeg started (merge):", cmd))
//       .on("end", () => {
//         console.log("✅ Videos merged:", outputFile);
//         try {
//           fs.unlinkSync(listFile);
//         } catch {}
//         resolve();
//       })
//       .on("error", (err) => {
//         console.error("❌ FFmpeg merge error:", err.message || err);
//         try {
//           if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
//         } catch {}
//         reject(err);
//       })
//       .save(outputFile);
//   });
// }
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
    //       title: "Chandrayaan-4 s Successful Lunar Landing",
    //       image_url: "https://www.example.com/chandrayaan4.jpg",
    //       title_hindi: "चंद्रयान-4 की सफल चंद्र लैंडिंग",
    //       india: true,
    //       description_speech:
    //         "भारत का चंद्रयान-4 चाँद पर सफलतापूर्वक उतरा।  इस मिशन से चाँद की सतह के बारे में नई जानकारी मिलने की उम्मीद है। यह भारत की अंतरिक्ष यात्रा में एक बड़ी उपलब्धि है।",
    //       description_display:
    //         "India s Chandrayaan-4 successfully landed on the moon. This mission is expected to provide new information about the lunar surface.  It represents a significant achievement in India s space exploration program.",
    //     },
    //     {
    //       title: "New Economic Reforms Announced",
    //       image_url: "https://www.example.com/economicreforms.jpg",
    //       title_hindi: "नई आर्थिक सुधारों की घोषणा",
    //       india: true,
    //       description_speech:
    //         "सरकार ने कई महत्वपूर्ण आर्थिक सुधारों की घोषणा की है, जिनमें  निवेश को बढ़ावा देना और रोजगार के अवसर पैदा करना शामिल है।  इन सुधारों से देश की अर्थव्यवस्था को मजबूती मिलेगी।",
    //       description_display:
    //         "The government announced several key economic reforms aimed at boosting investment and creating jobs. These reforms are expected to strengthen the nation s economy.",
    //     },
    //     {
    //       title: "Monsoon Season Update & Impact",
    //       image_url: "https://www.example.com/monsoon.jpg",
    //       title_hindi: "मानसून सीजन अपडेट और प्रभाव",
    //       india: true,
    //       description_speech:
    //         "इस साल मानसून सामान्य से अधिक रहा है जिससे कृषि को लाभ हुआ है। कुछ इलाकों में बाढ़ की भी समस्या आई है। सरकार राहत कार्य में जुटी है।",
    //       description_display:
    //         "This year s monsoon season has been above average, benefiting agriculture. However, some areas experienced flooding. The government is engaged in relief efforts.",
    //     },
    //     {
    //       title: "Supreme Court Ruling on Privacy",
    //       image_url: "https://www.example.com/supremecourt.jpg",
    //       title_hindi: "गोपनीयता पर सुप्रीम कोर्ट का फैसला",
    //       india: true,
    //       description_speech:
    //         "सुप्रीम कोर्ट ने गोपनीयता के अधिकार पर एक महत्वपूर्ण फैसला सुनाया है जिससे नागरिकों के अधिकारों को सुरक्षा मिलेगी।  यह फैसला कानूनी हलकों में चर्चा का विषय बना हुआ है।",
    //       description_display:
    //         "The Supreme Court delivered a landmark ruling on the right to privacy, providing further protection for citizens' rights. The decision has sparked considerable debate in legal circles.",
    //     },
    //     {
    //       title: "Political Developments in Bihar",
    //       image_url: "https://www.example.com/biharpolitics.jpg",
    //       title_hindi: "बिहार में राजनीतिक घटनाक्रम",
    //       india: true,
    //       description_speech:
    //         "बिहार में हाल ही में हुए राजनीतिक घटनाक्रमों से राज्य की राजनीति में हलचल मची हुई है।  विभिन्न दलों के बीच गठबंधन और टकराव देखने को मिल रहे हैं।",
    //       description_display:
    //         "Recent political developments in Bihar have created significant turbulence in the state s political landscape.  There have been shifts in alliances and conflicts between various parties.",
    //     },
    //   ],
    //   World: [
    //     {
    //       title: "Global Climate Change Summit",
    //       image_url: "https://www.example.com/climatesummit.jpg",
    //       title_hindi: "वैश्विक जलवायु परिवर्तन शिखर सम्मेलन",
    //       india: false,
    //       description_speech:
    //         "विश्व नेताओं का जलवायु परिवर्तन पर शिखर सम्मेलन हुआ जहाँ ग्लोबल वार्मिंग से निपटने के उपायों पर चर्चा हुई।  कार्बन उत्सर्जन कम करने पर ज़ोर दिया गया।",
    //       description_display:
    //         "World leaders convened for a climate change summit to discuss strategies for combating global warming.  Emphasis was placed on reducing carbon emissions.",
    //     },
    //     {
    //       title: "Ukraine Conflict Intensifies",
    //       image_url: "https://www.example.com/ukraine.jpg",
    //       title_hindi: "यूक्रेन संघर्ष तेज हुआ",
    //       india: false,
    //       description_speech:
    //         "यूक्रेन में युद्ध की स्थिति और बिगड़ी है।  अंतरराष्ट्रीय समुदाय  शांति स्थापित करने के प्रयास कर रहा है।  मानवीय संकट गहराता जा रहा है।",
    //       description_display:
    //         "The situation in Ukraine has worsened with the ongoing conflict. The international community is attempting to broker peace. The humanitarian crisis continues to deepen.",
    //     },
    //     {
    //       title: "Economic Slowdown in Europe",
    //       image_url: "https://www.example.com/europeslowdown.jpg",
    //       title_hindi: "यूरोप में आर्थिक मंदी",
    //       india: false,
    //       description_speech:
    //         "यूरोप के कई देश आर्थिक मंदी का सामना कर रहे हैं।  महंगाई और ऊर्जा संकट बड़ी चुनौतियाँ हैं।  सरकारें समाधान ढूँढने में जुटी हैं।",
    //       description_display:
    //         "Several European countries are facing an economic slowdown. Inflation and energy crises are major challenges. Governments are scrambling for solutions.",
    //     },
    //     {
    //       title: "New COVID-19 Variant Emerges",
    //       image_url: "https://www.example.com/covidvariant.jpg",
    //       title_hindi: "नया कोविड-19 वेरिएंट सामने आया",
    //       india: false,
    //       description_speech:
    //         "एक नया कोरोना वायरस वेरिएंट सामने आया है जिससे वैश्विक स्वास्थ्य संगठन चिंतित है।  नए वेरिएंट से निपटने की तैयारी की जा रही है।",
    //       description_display:
    //         "A new COVID-19 variant has emerged, causing concern for the World Health Organization. Preparations are underway to address this new variant.",
    //     },
    //     {
    //       title: "Tensions Rise in South China Sea",
    //       image_url: "https://www.example.com/southchinasea.jpg",
    //       title_hindi: "दक्षिण चीन सागर में तनाव बढ़ा",
    //       india: false,
    //       description_speech:
    //         "दक्षिण चीन सागर में क्षेत्रीय देशों के बीच तनाव बढ़ गया है।  क्षेत्रीय अखंडता को लेकर विवाद जारी है।  अंतरराष्ट्रीय समुदाय शांतिपूर्ण समाधान चाहता है।",
    //       description_display:
    //         "Tensions have risen in the South China Sea among regional nations. Disputes over territorial integrity persist. The international community seeks a peaceful resolution.",
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
