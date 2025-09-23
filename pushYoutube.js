// filename: fetchAllFinalVideosByDate.js
import fs from "fs";
import path from "path";
import dayjs from "dayjs";
import readline from "readline";
import { google } from "googleapis";
import { createCanvas, loadImage } from "canvas";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];
const TOKEN_PATH = "./token.json";
const LOGO_PATH = "./logo.png";

// --- Main function to fetch and upload all videos ---
export default async function getAllFinalVideosByDate() {
  const date = getYesterday();
  const folderPath = path.join("./output", date);

  if (!fs.existsSync(folderPath)) {
    console.log("Folder for date not found:", folderPath);
    return [];
  }

  const files = fs.readdirSync(folderPath);
  const videoFiles = files.filter(
    (file) => file.startsWith("final_") && /\.(mp4|mkv|mov|avi)$/.test(file)
  );

  if (videoFiles.length === 0) {
    console.log("No video files starting with final_ found in", folderPath);
    return [];
  }

  const uploadPromises = videoFiles.map(async (videoFile) => {
    try {
      const videoPath = path.join(folderPath, videoFile);
      const match = videoFile.match(
        /^final_([a-zA-Z]+)_.*\.(mp4|mkv|mov|avi)$/
      );
      const language = match ? match[1] : "unknown";

      const thumbnail = await generateThumbnail(language);
      const youtubeData = await uploadToYoutube(videoPath, language, thumbnail);

      return {
        path: videoPath,
        language,
        thumbnail,
        youtubeData,
        status: "success",
      };
    } catch (err) {
      console.error("❌ Error processing video:", videoFile, err);
      return { path: videoFile, status: "failed", error: err.toString() };
    }
  });

  const results = await Promise.allSettled(uploadPromises);
  console.log("All uploads completed:", results);
  return results;
}

// --- Example usage ---
function getYesterday() {
  //   return dayjs().subtract(1, "day").format("YYYY-MM-DD");
  return dayjs().format("YYYY-MM-DD");
}

// --- Thumbnail generation ---
async function generateThumbnail(lang) {
  const canvas = createCanvas(1080, 1920);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#222239";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (fs.existsSync(LOGO_PATH)) {
    const logo = await loadImage(LOGO_PATH);
    ctx.drawImage(logo, (canvas.width - 1000) / 2, 50, 1000, 800);
  }

  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 60, 1000, canvas.width - 120, 720, 28, true);

  ctx.fillStyle = "#d71e1f";
  roundRect(ctx, 60, 992, 28, 736, 8, true);

  ctx.fillStyle = "black";
  ctx.font = "bold 64px serif";
  ctx.textAlign = "left";
  wrapText(
    ctx,
    `${dayjs().format("YYYY-MM-DD")} • Daily News Update • News Shorts`,
    120,
    1150,
    canvas.width - 200,
    70
  );

  ctx.font = "600 42px sans-serif";
  ctx.fillStyle = "#000000";
  ctx.fillText("Top headlines & quick updates", 120, 1320);

  const langNames = { en: "English", hi: "Hindi", gu: "Gujarati" };
  ctx.font = "600 50px sans-serif";
  ctx.fillStyle = "#d71e1f";
  ctx.fillText(langNames[lang] || lang, 120, 1420);

  ctx.textAlign = "right";
  ctx.font = "500 30px sans-serif";
  ctx.fillStyle = "#9fb6da";
  ctx.fillText(
    "11:30 PM IST • New episode • Within 24 Hours News",
    canvas.width - 72,
    canvas.height - 48
  );

  const buffer = canvas.toBuffer("image/png");
  const thumbPath = path.join("./temp_thumbs", `thumb_${lang}.png`);
  fs.mkdirSync("./temp_thumbs", { recursive: true });
  fs.writeFileSync(thumbPath, buffer);
  return thumbPath;
}

// --- Helper functions ---
function roundRect(ctx, x, y, w, h, r, fill) {
  const min = Math.min(w / 2, h / 2);
  r = Math.min(r, min);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else line = testLine;
  }
  ctx.fillText(line, x, y);
}

// --- Google OAuth ---
function authorize(credentials) {
  return new Promise((resolve, reject) => {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
      oAuth2Client.setCredentials(token);
      resolve(oAuth2Client);
      return;
    }

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
    });
    console.log("Authorize this app by visiting:", authUrl);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("Enter the code from that page: ", (code) => {
      rl.close();
      oAuth2Client.getToken(code, (err, token) => {
        if (err) return reject(err);
        oAuth2Client.setCredentials(token);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
        console.log("✅ Token stored to", TOKEN_PATH);
        resolve(oAuth2Client);
      });
    });
  });
}

// --- Upload video to YouTube ---
async function uploadToYoutube(videoPath, language, ThumbnailPath) {
  const content = fs.readFileSync(
    "client_secret_944372979454-a2ero9ndeopgpvvqidgauo1m8cqhr64k.apps.googleusercontent.com.json"
  );
  const auth = await authorize(JSON.parse(content));
  const youtube = google.youtube({ version: "v3", auth });
  const fileSize = fs.statSync(videoPath).size;
  const publishDate = new Date().toISOString();

  const res = await youtube.videos.insert(
    {
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: `${getYesterday()} Daily News Update • #breakingnews #breakingnewsshorts`,
          description: `📝 Stay informed with top India & World news in 120 seconds!`,
          tags: [
            "within 24 hours news",
            "india news today",
            "breaking news shorts",
          ],
          categoryId: "25",
          defaultLanguage: language,
          defaultAudioLanguage: language,
          recordingDate: new Date().toISOString(),
        },
        status: {
          privacyStatus: "private",
          publishAt: publishDate,
          selfDeclaredMadeForKids: false,
          license: "youtube",
          embeddable: true,
          publicStatsViewable: true,
        },
      },
      media: { body: fs.createReadStream(videoPath) },
    },
    {
      onUploadProgress: (evt) => {
        const progress = (evt.bytesRead / fileSize) * 100;
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(
          `[${path.basename(videoPath)}] Uploading: ${progress.toFixed(2)}%`
        );
      },
    }
  );

  console.log(`\n✅ Video uploaded! ID: ${res.data.id}`);

  if (!ThumbnailPath || !fs.existsSync(ThumbnailPath))
    throw new Error("Thumbnail not found: " + ThumbnailPath);

  await youtube.thumbnails.set({
    videoId: res.data.id,
    media: { body: fs.createReadStream(ThumbnailPath) },
  });
  console.log("✅ Thumbnail uploaded for:", path.basename(videoPath));

  return { videoId: res.data.id, scheduledAt: publishDate };
}

// --- Run ---

// getAllFinalVideosByDate(date);

// // filename: fetchAllFinalVideosByDate.js
// import fs from "fs";
// import path from "path";
// import dayjs from "dayjs";
// import readline from "readline";
// import { google } from "googleapis";
// import { createCanvas, loadImage } from "canvas";

// const SCOPES = [
//   "https://www.googleapis.com/auth/youtube.upload",
//   "https://www.googleapis.com/auth/youtube.readonly",
// ];
// const TOKEN_PATH = "./token.json"; // will be created automatically
// const LOGO_PATH = "./logo.png"; // Add your logo path here

// async function getAllFinalVideosByDate(date) {
//   const folderPath = path.join("./output", date);

//   if (!fs.existsSync(folderPath)) {
//     console.log("Folder for date not found:", folderPath);
//     return [];
//   }

//   const files = fs.readdirSync(folderPath);

//   // Filter all videos starting with final_
//   const videoFiles = files.filter(
//     (file) => file.startsWith("final_") && /\.(mp4|mkv|mov|avi)$/.test(file)
//   );

//   if (videoFiles.length === 0) {
//     console.log("No video files starting with final_ found in", folderPath);
//     return [];
//   }

//   const videos = [];

//   for (const videoFile of videoFiles) {
//     const videoPath = path.join(folderPath, videoFile);
//     const match = videoFile.match(/^final_([a-zA-Z]+)_.*\.(mp4|mkv|mov|avi)$/);
//     const language = match ? match[1] : "unknown";

//     const thumbnails = await generateThumbnail(language);
//     const toYoutube = await uploadToYoutube(videoPath, language, thumbnails);

//     videos.push({ path: videoPath, language, thumbnails, toYoutube });
//   }

//   console.log(videos);
//   return videos;
// }

// // Example usage:
// function getYesterday() {
//   return dayjs().subtract(1, "day").format("YYYY-MM-DD");
// }

// // --- Generate thumbnail ---
// async function generateThumbnail(lang) {
//   const canvas = createCanvas(1080, 1920);
//   const ctx = canvas.getContext("2d");

//   // Background
//   ctx.fillStyle = "#222239";
//   ctx.fillRect(0, 0, canvas.width, canvas.height);

//   // Logo
//   if (fs.existsSync(LOGO_PATH)) {
//     const logo = await loadImage(LOGO_PATH);
//     ctx.drawImage(logo, (canvas.width - 1000) / 2, 50, 1000, 800);
//   }

//   // Bottom white card
//   ctx.fillStyle = "#ffffff";
//   roundRect(ctx, 60, 1000, canvas.width - 120, 720, 28, true);

//   // Red ribbon
//   ctx.fillStyle = "#d71e1f";
//   roundRect(ctx, 60, 992, 28, 736, 8, true);

//   // Headline
//   ctx.fillStyle = "black";
//   ctx.font = "bold 64px serif";
//   ctx.textAlign = "left";
//   wrapText(
//     ctx,
//     `${dayjs().format("YYYY-MM-DD")} • Daily News Update • News Shorts`,
//     120,
//     1150,
//     canvas.width - 200,
//     70
//   );

//   // Subtitle
//   ctx.font = "600 42px sans-serif";
//   ctx.fillStyle = "#000000";
//   ctx.fillText("Top headlines & quick updates", 120, 1320);

//   // Language info
//   const langNames = { en: "English", hi: "Hindi", gu: "Gujarati" };
//   ctx.font = "600 50px sans-serif";
//   ctx.fillStyle = "#d71e1f";
//   ctx.fillText(langNames[lang] || lang, 120, 1420);

//   // Footer
//   ctx.textAlign = "right";
//   ctx.font = "500 30px sans-serif";
//   ctx.fillStyle = "#9fb6da";
//   ctx.fillText(
//     "11:30 PM IST • New episode • Within 24 Hours News",
//     canvas.width - 72,
//     canvas.height - 48
//   );

//   const buffer = canvas.toBuffer("image/png");
//   const thumbPath = path.join("./temp_thumbs", `thumb_${lang}.png`);

//   fs.mkdirSync("./temp_thumbs", { recursive: true });
//   fs.writeFileSync(thumbPath, buffer);
//   return thumbPath;
// }

// // --- Helper functions ---
// function roundRect(ctx, x, y, w, h, r, fill) {
//   const min = Math.min(w / 2, h / 2);
//   r = Math.min(r, min);
//   ctx.beginPath();
//   ctx.moveTo(x + r, y);
//   ctx.arcTo(x + w, y, x + w, y + h, r);
//   ctx.arcTo(x + w, y + h, x, y + h, r);
//   ctx.arcTo(x, y + h, x, y, r);
//   ctx.arcTo(x, y, x + r, y, r);
//   ctx.closePath();
//   if (fill) ctx.fill();
// }

// function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
//   const words = text.split(" ");
//   let line = "";
//   for (let n = 0; n < words.length; n++) {
//     const testLine = line + words[n] + " ";
//     const metrics = ctx.measureText(testLine);
//     if (metrics.width > maxWidth && n > 0) {
//       ctx.fillText(line, x, y);
//       line = words[n] + " ";
//       y += lineHeight;
//     } else line = testLine;
//   }
//   ctx.fillText(line, x, y);
// }

// // --- Google OAuth ---
// function authorize(credentials, callback) {
//   const { client_secret, client_id, redirect_uris } = credentials.installed;
//   const oAuth2Client = new google.auth.OAuth2(
//     client_id,
//     client_secret,
//     redirect_uris[0]
//   );

//   if (fs.existsSync(TOKEN_PATH)) {
//     const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
//     oAuth2Client.setCredentials(token);
//     return callback(oAuth2Client);
//   }

//   const authUrl = oAuth2Client.generateAuthUrl({
//     access_type: "offline",
//     scope: SCOPES,
//   });
//   console.log("Authorize this app by visiting:", authUrl);

//   const rl = readline.createInterface({
//     input: process.stdin,
//     output: process.stdout,
//   });
//   rl.question("Enter the code from that page: ", (code) => {
//     rl.close();
//     oAuth2Client.getToken(code, (err, token) => {
//       if (err) throw new Error("Error retrieving access token: " + err);
//       oAuth2Client.setCredentials(token);
//       fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
//       console.log("✅ Token stored to", TOKEN_PATH);
//       callback(oAuth2Client);
//     });
//   });
// }

// // --- Upload video to YouTube ---
// async function uploadToYoutube(videoPath, language, ThumbnailPath) {
//   return new Promise((resolve, reject) => {
//     fs.readFile(
//       "client_secret_944372979454-a2ero9ndeopgpvvqidgauo1m8cqhr64k.apps.googleusercontent.com.json",
//       (err, content) => {
//         if (err) return reject("Error loading client secret: " + err);

//         authorize(JSON.parse(content), async (auth) => {
//           try {
//             const youtube = google.youtube({ version: "v3", auth });
//             const fileSize = fs.statSync(videoPath).size;
//             const publishDate = new Date().toISOString(); // proper ISO date

//             const res = await youtube.videos.insert(
//               {
//                 part: ["snippet", "status"],
//                 requestBody: {
//                   snippet: {
//                     title: `${getYesterday()} Daily News Update • #breakingnews #breakingnewsshorts`,
//                     description: `📝 Description
// Stay informed with the top India and World news in just 120 seconds!

// 📌 Your daily news dose, fresh and fast.
// 🔔 Subscribe for Within 24 Hours – Daily Shorts Updates!
// #Within24Hours #Last24Hours #IndiaNews #WorldNews #BreakingNews
// #EconomicPolicy #GlobalNews #DailyUpdate #breakingnews #breakingnewsshorts`,
//                     tags: [
//                       "within 24 hours news",
//                       "india news today",
//                       "india latest news",
//                       "24 hours news india",
//                       "india daily update",
//                       "breaking news india",
//                       "last 24 hours breaking news",
//                       "breaking news",
//                       "breaking news shorts",
//                     ],
//                     categoryId: "25",
//                     defaultLanguage: language,
//                     defaultAudioLanguage: language,
//                     recordingDate: new Date().toISOString(),
//                   },
//                   status: {
//                     privacyStatus: "private",
//                     publishAt: publishDate,
//                     selfDeclaredMadeForKids: false,
//                     license: "youtube",
//                     embeddable: true,
//                     publicStatsViewable: true,
//                   },
//                 },
//                 media: { body: fs.createReadStream(videoPath) },
//               },
//               {
//                 onUploadProgress: (evt) => {
//                   const progress = (evt.bytesRead / fileSize) * 100;
//                   process.stdout.clearLine(0);
//                   process.stdout.cursorTo(0);
//                   process.stdout.write(`Uploading: ${progress.toFixed(2)}%`);
//                 },
//               }
//             );

//             console.log(`\n✅ Video uploaded! ID: ${res.data.id}`);

//             if (!ThumbnailPath || !fs.existsSync(ThumbnailPath)) {
//               return reject(
//                 "❌ Thumbnail path missing or not found: " + ThumbnailPath
//               );
//             }

//             // Upload thumbnail
//             await youtube.thumbnails.set({
//               videoId: res.data.id,
//               media: { body: fs.createReadStream(ThumbnailPath) },
//             });

//             console.log("✅ Thumbnail uploaded successfully!");
//             resolve({ videoId: res.data.id, scheduledAt: publishDate });
//           } catch (e) {
//             reject(e);
//           }
//         });
//       }
//     );
//   });
// }

// // --- Run ---
// const date = getYesterday();
// getAllFinalVideosByDate(date);

// // filename: fetchAllFinalVideosByDate.js
// import fs from "fs";
// import path from "path";
// import dayjs from "dayjs";
// import readline from "readline";
// import { google } from "googleapis";

// const SCOPES = [
//   "https://www.googleapis.com/auth/youtube.upload",
//   "https://www.googleapis.com/auth/youtube.readonly",
// ];
// const TOKEN_PATH = "./token.json"; // will be created automatically

// function getAllFinalVideosByDate(date) {
//   const folderPath = path.join("./output", date);

//   if (!fs.existsSync(folderPath)) {
//     console.log("Folder for date not found:", folderPath);
//     return [];
//   }

//   const files = fs.readdirSync(folderPath);

//   // Filter all videos starting with final_
//   const videoFiles = files.filter(
//     (file) => file.startsWith("final_") && /\.(mp4|mkv|mov|avi)$/.test(file)
//   );

//   if (videoFiles.length === 0) {
//     console.log("No video files starting with final_ found in", folderPath);
//     return [];
//   }

//   // Map videos to path + language
//   const videos = videoFiles.map((videoFile) => {
//     const videoPath = path.join(folderPath, videoFile);
//     const match = videoFile.match(/^final_([a-zA-Z]+)_.*\.(mp4|mkv|mov|avi)$/);
//     const language = match ? match[1] : "unknown";
//     const thumbnails = generateThumbnail(language);
//     const toYoutube = uploadToYoutube(videoPath, language, thumbnails);
//     return { path: videoPath, language, thumbnails, toYoutube };
//   });

//   console.log(videos);
//   return videos;
// }

// // Example usage:
// function getYesterday() {
//   return dayjs().subtract(1, "day").format("YYYY-MM-DD");
// }

// // --- Generate thumbnail ---
// async function generateThumbnail(lang) {
//   const canvas = createCanvas(1080, 1920);
//   const ctx = canvas.getContext("2d");

//   // Background
//   ctx.fillStyle = "#222239";
//   ctx.fillRect(0, 0, canvas.width, canvas.height);

//   // Logo
//   if (fs.existsSync(LOGO_PATH)) {
//     const logo = await loadImage(LOGO_PATH);
//     ctx.drawImage(logo, (canvas.width - 1000) / 2, 50, 1000, 800);
//   }

//   // Bottom white card
//   ctx.fillStyle = "#ffffff";
//   roundRect(ctx, 60, 1000, canvas.width - 120, 720, 28, true);

//   // Red ribbon
//   ctx.fillStyle = "#d71e1f";
//   roundRect(ctx, 60, 992, 28, 736, 8, true);

//   // Headline
//   ctx.fillStyle = "black";
//   ctx.font = "bold 64px serif";
//   ctx.textAlign = "left";
//   wrapText(
//     ctx,
//     `${dayjs().format("YYYY-MM-DD")} • Daily News Update • News Shorts`,
//     120,
//     1150,
//     canvas.width - 200,
//     70
//   );

//   // Subtitle
//   ctx.font = "600 42px sans-serif";
//   ctx.fillStyle = "#000000";
//   ctx.fillText("Top headlines & quick updates", 120, 1320);

//   // Language info
//   const langNames = { en: "English", hi: "Hindi", gu: "Gujarati" };
//   ctx.font = "600 50px sans-serif";
//   ctx.fillStyle = "#d71e1f";
//   ctx.fillText(langNames[lang] || lang, 120, 1420);

//   // Footer
//   ctx.textAlign = "right";
//   ctx.font = "500 30px sans-serif";
//   ctx.fillStyle = "#9fb6da";
//   ctx.fillText(
//     "11:30 PM IST • New episode • Within 24 Hours News",
//     canvas.width - 72,
//     canvas.height - 48
//   );

//   const buffer = canvas.toBuffer("image/png");
//   const thumbPath = path.join("./temp_thumbs", `thumb_${lang}.png`);

//   fs.mkdirSync("./temp_thumbs", { recursive: true });
//   fs.writeFileSync(thumbPath, buffer);
//   return thumbPath;
// }

// // --- Helper functions ---
// function roundRect(ctx, x, y, w, h, r, fill) {
//   const min = Math.min(w / 2, h / 2);
//   r = Math.min(r, min);
//   ctx.beginPath();
//   ctx.moveTo(x + r, y);
//   ctx.arcTo(x + w, y, x + w, y + h, r);
//   ctx.arcTo(x + w, y + h, x, y + h, r);
//   ctx.arcTo(x, y + h, x, y, r);
//   ctx.arcTo(x, y, x + r, y, r);
//   ctx.closePath();
//   if (fill) ctx.fill();
// }

// function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
//   const words = text.split(" ");
//   let line = "";
//   for (let n = 0; n < words.length; n++) {
//     const testLine = line + words[n] + " ";
//     const metrics = ctx.measureText(testLine);
//     if (metrics.width > maxWidth && n > 0) {
//       ctx.fillText(line, x, y);
//       line = words[n] + " ";
//       y += lineHeight;
//     } else line = testLine;
//   }
//   ctx.fillText(line, x, y);
// }

// // Dynamically Push This video to Youtube shorts directly.
// //Add code here

// function authorize(credentials, callback) {
//   const { client_secret, client_id, redirect_uris } = credentials.installed;
//   const oAuth2Client = new google.auth.OAuth2(
//     client_id,
//     client_secret,
//     redirect_uris[0]
//   );

//   // Check for saved token
//   if (fs.existsSync(TOKEN_PATH)) {
//     const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
//     oAuth2Client.setCredentials(token);
//     return callback(oAuth2Client);
//   }

//   // Otherwise, get new token
//   const authUrl = oAuth2Client.generateAuthUrl({
//     access_type: "offline",
//     scope: SCOPES,
//   });
//   console.log("Authorize this app by visiting:", authUrl);

//   const rl = readline.createInterface({
//     input: process.stdin,
//     output: process.stdout,
//   });
//   rl.question("Enter the code from that page: ", (code) => {
//     rl.close();
//     oAuth2Client.getToken(code, (err, token) => {
//       if (err) throw new Error("Error retrieving access token: " + err);
//       oAuth2Client.setCredentials(token);
//       fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
//       console.log("✅ Token stored to", TOKEN_PATH);
//       callback(oAuth2Client);
//     });
//   });
// }

// async function uploadToYoutube(videoPath, language, ThumbnailPath) {
//   return new Promise((resolve, reject) => {
//     fs.readFile(
//       "client_secret_944372979454-a2ero9ndeopgpvvqidgauo1m8cqhr64k.apps.googleusercontent.com.json",
//       (err, content) => {
//         if (err) return reject("Error loading client secret: " + err);

//         authorize(JSON.parse(content), async (auth) => {
//           try {
//             const youtube = google.youtube({ version: "v3", auth });
//             const fileSize = fs.statSync(videoPath).size;
//             const publishDate = dayjs().format("YYYY-MM-DD");
//             console.log("videoData", publishDate);

//             await youtube.videos.insert(
//               {
//                 part: ["snippet", "status"],
//                 requestBody: {
//                   snippet: {
//                     title: `${getYesterday()} Daily News Update • #breakingnews #breakingnewsshorts`,
//                     description: `📝 Description
// Stay informed with the top India and World news in just 120 seconds!

// 📌 Your daily news dose, fresh and fast.
// 🔔 Subscribe for Within 24 Hours – Daily Shorts Updates!
// #Within24Hours #Last24Hours #IndiaNews #WorldNews #BreakingNews
//  #EconomicPolicy  #GlobalNews #DailyUpdate #breakingnews  #breakingnewsshorts`,
//                     tags: [
//                       "within 24 hours news",
//                       "india news today",
//                       "india latest news",
//                       "24 hours news india",
//                       "india daily update",
//                       "breaking news india",
//                       "last 24 hours breaking news",
//                       "breaking news",
//                       "breaking news shorts",
//                     ],
//                     categoryId: "25",
//                     defaultLanguage: language,
//                     defaultAudioLanguage: language,
//                     recordingDate: new Date().toISOString(),
//                   },
//                   status: {
//                     privacyStatus: "private",
//                     publishAt: publishDate.toISOString(), // ✅ correct RFC 3339 UTC
//                     selfDeclaredMadeForKids: false,
//                     license: "youtube",
//                     embeddable: true,
//                     publicStatsViewable: true,
//                   },
//                 },
//                 media: { body: fs.createReadStream(videoPath) },
//               },
//               {
//                 onUploadProgress: (evt) => {
//                   const progress = (evt.bytesRead / fileSize) * 100;
//                   process.stdout.clearLine(0);
//                   process.stdout.cursorTo(0);
//                   process.stdout.write(`Uploading: ${progress.toFixed(2)}%`);
//                 },
//               },
//               (err, response) => {
//                 if (err) return reject("❌ Upload Error: " + err);

//                 console.log(`\n✅ Video uploaded! ID: ${response.data.id}`);
//                 console.log(`📅 Scheduled: ${publishDate}`);
//                 if (!ThumbnailPath || !fs.existsSync(ThumbnailPath)) {
//                   return reject(
//                     "❌ Thumbnail path is missing or file not found: " +
//                       outputThumbnailPath
//                   );
//                 }
//                 // Upload thumbnail
//                 youtube.thumbnails.set(
//                   {
//                     videoId: response.data.id,
//                     media: {
//                       body: fs.createReadStream(ThumbnailPath),
//                     },
//                   },
//                   (thumbErr) => {
//                     if (thumbErr)
//                       return reject("❌ Thumbnail Error: " + thumbErr);
//                     console.log("✅ Thumbnail uploaded successfully!");

//                     resolve({
//                       videoId: response.data.id,
//                       scheduledAt: publishDate,
//                       ...videoData,
//                     });
//                   }
//                 );
//               }
//             );
//           } catch (e) {
//             reject(e);
//           }
//         });
//       }
//     );
//   });
// }

// const date = getYesterday();
// getAllFinalVideosByDate(date);
