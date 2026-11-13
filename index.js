import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 8000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// CORS: with credentials, the origin must be exact (no "*").
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error("MongoDB connection failed:", err);
    process.exit(1); // no point running the server without a database
  }
}

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("loftlight");
const studioCollection = db.collection("studio");

// One owner can't list the same title in the same category twice.
// (Same title in a different category is allowed.)
// If this throws, you have old test documents without titleKey: delete them.
try {
  await studioCollection.createIndex(
    { ownerEmail: 1, titleKey: 1, category: 1 },
    { unique: true },
  );
} catch (err) {
  console.error(
    "Couldn’t create the unique index. Delete old test studios and restart.",
    err.message,
  );
  process.exit(1);
}

// ---------- helpers ----------
const CATEGORIES = [
  "Photo Studio",
  "Film Stage",
  "Podcast Lounge",
  "Music Suite",
  "Workshop",
];
const AMENITIES = [
  "Wi-Fi",
  "Natural light",
  "Green room",
  "Parking",
  "Soundproofing",
  "Lighting kit",
  "Coffee bar",
  "Backdrops",
];

const makeTitleKey = (title) => title.trim().replace(/\s+/g, " ").toLowerCase();

const isHttpUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

// Checks the request body and builds the document to save.
// Only the fields listed here are saved, so nobody can sneak in extra fields.
function buildStudio(body = {}) {
  const title = String(body.title ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const location = String(body.location ?? "").trim();
  const overview = String(body.overview ?? "").trim();
  const ownerEmail = String(body.ownerEmail ?? "")
    .trim()
    .toLowerCase(); // TODO: take from the verified JWT
  const ownerName = String(body.ownerName ?? "").trim();
  const hourlyRate = Number(body.hourlyRate);
  const deposit = Number(body.deposit ?? 0);
  const capacity = Number(body.capacity);
  const images = Array.isArray(body.images)
    ? body.images.map((u) => String(u).trim()).filter(Boolean)
    : [];
  const amenities = Array.isArray(body.amenities) ? body.amenities : [];
  const category = body.category;

  if (title.length < 3 || title.length > 80)
    return { error: "Title must be 3 to 80 characters." };
  if (!CATEGORIES.includes(category))
    return { error: "Choose a valid category." };
  if (!(hourlyRate > 0) || hourlyRate > 10000)
    return { error: "Hourly rate must be more than $0 and at most $10,000." };
  if (!(deposit >= 0)) return { error: "Deposit can’t be negative." };
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000)
    return { error: "Capacity must be a whole number from 1 to 1,000." };
  if (location.length < 5) return { error: "Enter the studio’s address." };
  if (images.length < 1 || images.length > 5)
    return { error: "Add 1 to 5 images." };
  if (!images.every(isHttpUrl))
    return { error: "Every image must be a valid http(s) link." };
  if (new Set(images).size !== images.length)
    return { error: "Each image URL must be different." };
  if (amenities.length < 1 || !amenities.every((a) => AMENITIES.includes(a)))
    return { error: "Pick at least one valid amenity." };
  if (overview.length < 20 || overview.length > 1000)
    return { error: "Overview must be 20 to 1,000 characters." };
  if (!/^\S+@\S+\.\S+$/.test(ownerEmail))
    return { error: "Host email is missing or invalid." };

  return {
    doc: {
      title,
      titleKey: makeTitleKey(title),
      category,
      hourlyRate,
      deposit,
      capacity,
      location,
      images,
      amenities,
      overview,
      ownerName,
      ownerEmail,
      rating: 0,
      createdAt: new Date(),
    },
  };
}

// ---------- routes ----------
app.post("/studios", async (req, res) => {
  const { error, doc } = buildStudio(req.body);
  if (error) return res.status(400).json({ message: error });

  try {
    const result = await studioCollection.insertOne(doc);
    res.status(201).json({ insertedId: result.insertedId });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: `You already have “${doc.title}” listed as ${doc.category}. Choose a different category or name.`,
      });
    }
    console.error(err);
    res
      .status(500)
      .json({ message: "Couldn’t save the studio. Please try again." });
  }
});

app.get("/all-studios", async (req, res) => {
  const result = await studioCollection.find().toArray();
  res.send(result);
});
app.get("/all-studios/:id", async (req, res) => {
  const { id } = req.params;
  const result = await studioCollection.findOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.get("/", (req, res) => {
  res.send("Loftlight API is running.");
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
