import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ----------------------------------------------------
// DB CONFIGURATION AND LAZY FALLBACK STORE
// ----------------------------------------------------
const SUPABASE_URL = "https://qynhcgineyysawgxfebq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5bmhjZ2luZXl5c2F3Z3hmZWJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzODI2OTMsImV4cCI6MjA5Njk1ODY5M30.S98gSTEQEAHDoP4EZwMo15ci9Zn9ejd2FzgVbAKb7w4";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5bmhjZ2luZXl5c2F3Z3hmZWJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTM4MjY5MywiZXhwIjoyMDk2OTU4NjkzfQ.zIlrbYespnLiR4Z1ffvqRVBmBATRVwAp_VSpl--Qgdk";

let supabase: any = null;
let isFallbackMode = true;
let fallbackReason = "No environment variables configured.";

console.log("Initializing Supabase integration...");
console.log("SUPABASE_URL configured:", SUPABASE_URL ? "YES" : "NO");
console.log("SUPABASE_ANON_KEY configured:", SUPABASE_ANON_KEY ? "YES" : "NO");

const activeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

if (SUPABASE_URL && activeKey) {
  try {
    supabase = createClient(SUPABASE_URL, activeKey);
    isFallbackMode = false;
    fallbackReason = "";
    console.log("Successfully initialized Supabase client!");
  } catch (err: any) {
    console.error("Error creating Supabase client:", err.message);
    fallbackReason = `Supabase initialization error: ${err.message}`;
  }
} else {
  console.warn("Supabase credentials missing. Running in-memory fallback store.");
}

// In-Memory Database Fallbacks
interface MemoryRoom {
  room_code: string;
  title: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface MemoryStroke {
  id: string;
  room_code: string;
  user_id: string;
  tool: string;
  color: string;
  size: number;
  points: any;
  is_deleted: boolean;
  created_at: string;
}

interface MemoryPeer {
  room_code: string;
  peer_id: string;
  nickname: string;
  last_seen: string;
  created_at: string;
}

const memoryRooms: MemoryRoom[] = [];
const memoryStrokes: MemoryStroke[] = [];
const memoryPeers: MemoryPeer[] = [];

// Helper generator for 6-character unique room code
function generateRoomCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ----------------------------------------------------
// HTTP API ENDPOINTS
// ----------------------------------------------------

// Server status API - discloses database configuration state
app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    dbMode: isFallbackMode ? "fallback" : "supabase",
    fallbackReason,
    supabaseUrl: SUPABASE_URL ? `${SUPABASE_URL.substring(0, 15)}...` : null
  });
});

// Create Room
app.post("/api/rooms", async (req, res) => {
  try {
    const { title, nickname } = req.body;
    let code = generateRoomCode();
    const roomTitle = title || `Room ${code}`;

    // Ensure uniqueness by looping up to 5 times
    let attempts = 0;
    let finalCode = code;

    while (attempts < 5) {
      if (!isFallbackMode && supabase) {
        // Query if exists
        const { data, error } = await supabase
          .from("rooms")
          .select("room_code")
          .eq("room_code", finalCode)
          .maybeSingle();

        if (!error && !data) {
          // Unique room code found
          break;
        }
      } else {
        const found = memoryRooms.find(r => r.room_code === finalCode);
        if (!found) {
          break;
        }
      }
      finalCode = generateRoomCode();
      attempts++;
    }

    if (!isFallbackMode && supabase) {
      const { data, error } = await supabase
        .from("rooms")
        .insert({
          room_code: finalCode,
          title: roomTitle,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        // If SQL tables are not made, catch it and recommend fallback mode!
        if (error.code === "P0001" || error.message?.includes("relation") || error.code === "42P01") {
          console.warn("Supabase database tables do not exist. Dynamically falling back to in-memory.");
          isFallbackMode = true;
          fallbackReason = "Database tables do not exist in Supabase yet. Run the schema.sql in Supabase SQL editor.";
        } else {
          throw error;
        }
      } else {
        return res.json({
          roomCode: finalCode,
          title: roomTitle,
          dbMode: "supabase",
          message: "Room created successfully on Supabase!"
        });
      }
    }

    // In-memory Save / Fallback triggered
    const newRoom: MemoryRoom = {
      room_code: finalCode,
      title: roomTitle,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memoryRooms.push(newRoom);

    return res.json({
      roomCode: finalCode,
      title: roomTitle,
      dbMode: "fallback",
      message: fallbackReason ? `Created in-memory: ${fallbackReason}` : "Room created in-memory fallback successfully!"
    });

  } catch (error: any) {
    console.error("Room creation error:", error);
    res.status(500).json({ error: error.message || "Failed to create room." });
  }
});

// Get Room Information
app.get("/api/rooms/:roomCode", async (req, res) => {
  try {
    const { roomCode } = req.params;
    const cleanCode = roomCode.toUpperCase();

    if (!isFallbackMode && supabase) {
      const { data, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("room_code", cleanCode)
        .maybeSingle();

      if (error) {
        if (error.code === "42P01" || error.message?.includes("relation")) {
          // Switch to fallback if table not made
          isFallbackMode = true;
          fallbackReason = "Database tables do not exist in Supabase yet. Run schema.sql.";
        } else {
          throw error;
        }
      } else if (data) {
        return res.json({
          roomCode: data.room_code,
          title: data.title || `Room ${data.room_code}`,
          createdAt: data.created_at,
          dbMode: "supabase"
        });
      }
    }

    // Fallback store search
    const room = memoryRooms.find(r => r.room_code === cleanCode);
    if (room) {
      return res.json({
        roomCode: room.room_code,
        title: room.title,
        createdAt: room.created_at,
        dbMode: "fallback"
      });
    }

    // Default: allow testing rooms on-the-fly in in-memory mode if they don't exist
    // Creates mock rooms on request so that people can easily key in a random room and join
    if (isFallbackMode) {
      const newRoom: MemoryRoom = {
        room_code: cleanCode,
        title: `Auto-created ${cleanCode}`,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      memoryRooms.push(newRoom);
      return res.json({
        roomCode: cleanCode,
        title: newRoom.title,
        createdAt: newRoom.created_at,
        dbMode: "fallback"
      });
    }

    return res.status(404).json({ error: `Room ${cleanCode} does not exist.` });

  } catch (error: any) {
    console.error("Get room error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch room info." });
  }
});

// Fetch Room Strokes
app.get("/api/rooms/:roomCode/strokes", async (req, res) => {
  try {
    const { roomCode } = req.params;
    const cleanCode = roomCode.toUpperCase();

    if (!isFallbackMode && supabase) {
      const { data, error } = await supabase
        .from("strokes")
        .select("*")
        .eq("room_code", cleanCode)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });

      if (error) {
        throw error;
      }

      const formatted = (data || []).map((s: any) => ({
        id: s.id,
        room_code: s.room_code,
        user_id: s.user_id,
        tool: s.tool,
        color: s.color,
        size: s.size,
        points: typeof s.points === "string" ? JSON.parse(s.points) : s.points,
        created_at: s.created_at
      }));

      return res.json({
        strokes: formatted,
        dbMode: "supabase"
      });
    }

    // Fallback mode retrieve
    const strokes = memoryStrokes.filter(s => s.room_code === cleanCode && !s.is_deleted);
    return res.json({
      strokes,
      dbMode: "fallback"
    });

  } catch (error: any) {
    console.error("Get strokes error:", error);
    res.status(500).json({ error: error.message || "Failed to load strokes." });
  }
});

// Save Stroke
app.post("/api/rooms/:roomCode/strokes", async (req, res) => {
  try {
    const { roomCode } = req.params;
    const cleanCode = roomCode.toUpperCase();
    const { id, userId, tool, color, size, points } = req.body;

    if (!id || !userId || !tool) {
      return res.status(400).json({ error: "Missing required stroke fields." });
    }

    if (!isFallbackMode && supabase) {
      const { error } = await supabase
        .from("strokes")
        .insert({
          id,
          room_code: cleanCode,
          user_id: userId,
          tool,
          color,
          size,
          points: points, // Supabase jsonb handles JSON object arrays directly
          is_deleted: false,
          created_at: new Date().toISOString()
        });

      if (error) {
        throw error;
      }

      return res.json({ success: true, dbMode: "supabase" });
    }

    // Fallback saving
    // Avoid saving duplicated strokes
    const existingIndex = memoryStrokes.findIndex(s => s.id === id);
    const newStroke: MemoryStroke = {
      id,
      room_code: cleanCode,
      user_id: userId,
      tool,
      color,
      size,
      points,
      is_deleted: false,
      created_at: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      memoryStrokes[existingIndex] = newStroke;
    } else {
      memoryStrokes.push(newStroke);
    }

    return res.json({ success: true, dbMode: "fallback" });

  } catch (error: any) {
    console.error("Save stroke error:", error);
    res.status(500).json({ error: error.message || "Failed to save stroke." });
  }
});

// Undo Stroke (Soft Delete)
app.post("/api/rooms/:roomCode/strokes/:strokeId/undo", async (req, res) => {
  try {
    const { roomCode, strokeId } = req.params;
    const cleanCode = roomCode.toUpperCase();

    if (!isFallbackMode && supabase) {
      const { error } = await supabase
        .from("strokes")
        .update({ is_deleted: true })
        .eq("id", strokeId)
        .eq("room_code", cleanCode);

      if (error) throw error;
      return res.json({ success: true, dbMode: "supabase" });
    }

    // Fallback undo
    const index = memoryStrokes.findIndex(s => s.id === strokeId && s.room_code === cleanCode);
    if (index >= 0) {
      memoryStrokes[index].is_deleted = true;
    }
    return res.json({ success: true, dbMode: "fallback" });

  } catch (error: any) {
    console.error("Undo error:", error);
    res.status(500).json({ error: error.message || "Failed to process undo request." });
  }
});

// Redo Strike API (Restore deleted stroke or upsert)
app.post("/api/rooms/:roomCode/strokes/:strokeId/redo", async (req, res) => {
  try {
    const { roomCode, strokeId } = req.params;
    const cleanCode = roomCode.toUpperCase();
    const strokeData = req.body;

    if (!isFallbackMode && supabase) {
      // Direct upsert or update to is_deleted = false
      const { error } = await supabase
        .from("strokes")
        .upsert({
          id: strokeId,
          room_code: cleanCode,
          user_id: strokeData.userId,
          tool: strokeData.tool,
          color: strokeData.color,
          size: strokeData.size,
          points: strokeData.points,
          is_deleted: false,
          created_at: new Date().toISOString()
        });

      if (error) throw error;
      return res.json({ success: true, dbMode: "supabase" });
    }

    // Fallback redo
    const idx = memoryStrokes.findIndex(s => s.id === strokeId && s.room_code === cleanCode);
    if (idx >= 0) {
      memoryStrokes[idx].is_deleted = false;
    } else {
      memoryStrokes.push({
        id: strokeId,
        room_code: cleanCode,
        user_id: strokeData.userId,
        tool: strokeData.tool,
        color: strokeData.color,
        size: strokeData.size,
        points: strokeData.points,
        is_deleted: false,
        created_at: new Date().toISOString()
      });
    }

    return res.json({ success: true, dbMode: "fallback" });

  } catch (error: any) {
    console.error("Redo error:", error);
    res.status(500).json({ error: error.message || "Failed to process redo request." });
  }
});

// Clear All Strokes in Board
app.post("/api/rooms/:roomCode/clear", async (req, res) => {
  try {
    const { roomCode } = req.params;
    const cleanCode = roomCode.toUpperCase();

    if (!isFallbackMode && supabase) {
      const { error } = await supabase
        .from("strokes")
        .update({ is_deleted: true })
        .eq("room_code", cleanCode);

      if (error) throw error;
      return res.json({ success: true, dbMode: "supabase" });
    }

    // Fallback wipeout
    memoryStrokes.forEach((s) => {
      if (s.room_code === cleanCode) {
        s.is_deleted = true;
      }
    });

    return res.json({ success: true, dbMode: "fallback" });

  } catch (error: any) {
    console.error("Clear board error:", error);
    res.status(500).json({ error: error.message || "Failed to clear canvas." });
  }
});

// Register Peering Client in Board
app.post("/api/rooms/:roomCode/peers", async (req, res) => {
  try {
    const { roomCode } = req.params;
    const cleanCode = roomCode.toUpperCase();
    const { peerId, nickname } = req.body;

    if (!peerId) {
      return res.status(400).json({ error: "Missing peerId." });
    }

    if (!isFallbackMode && supabase) {
      const { error } = await supabase
        .from("room_peers")
        .upsert({
          room_code: cleanCode,
          peer_id: peerId,
          nickname,
          last_seen: new Date().toISOString()
        }, {
          onConflict: "room_code,peer_id"
        });

      if (error) throw error;
      return res.json({ success: true, dbMode: "supabase" });
    }

    // Fallback Register peer
    const nowStr = new Date().toISOString();
    const existing = memoryPeers.find(p => p.room_code === cleanCode && p.peer_id === peerId);
    if (existing) {
      existing.nickname = nickname || existing.nickname;
      existing.last_seen = nowStr;
    } else {
      memoryPeers.push({
        room_code: cleanCode,
        peer_id: peerId,
        nickname: nickname || "Anonymous",
        last_seen: nowStr,
        created_at: nowStr
      });
    }

    return res.json({ success: true, dbMode: "fallback" });

  } catch (error: any) {
    console.error("Register peer error:", error);
    res.status(500).json({ error: error.message || "Failed to register peer." });
  }
});

// Fetch Active Peers
app.get("/api/rooms/:roomCode/peers", async (req, res) => {
  try {
    const { roomCode } = req.params;
    const cleanCode = roomCode.toUpperCase();

    // Define 30-seconds inactivity cutoff limit
    const cutoffDate = new Date(Date.now() - 30 * 1000).toISOString();

    if (!isFallbackMode && supabase) {
      const { data, error } = await supabase
        .from("room_peers")
        .select("*")
        .eq("room_code", cleanCode)
        .gte("last_seen", cutoffDate);

      if (error) throw error;
      return res.json({
        peers: data || [],
        dbMode: "supabase"
      });
    }

    // Fallback active peer fetch
    const now = Date.now();
    const activeFallback = memoryPeers.filter(p => {
      const lastSeenMs = new Date(p.last_seen).getTime();
      return p.room_code === cleanCode && (now - lastSeenMs) <= 30000;
    });

    return res.json({
      peers: activeFallback,
      dbMode: "fallback"
    });

  } catch (error: any) {
    console.error("List peers error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch peers." });
  }
});

// Update client heartbeat timestamp
app.post("/api/rooms/:roomCode/heartbeat", async (req, res) => {
  try {
    const { roomCode } = req.params;
    const cleanCode = roomCode.toUpperCase();
    const { peerId } = req.body;

    if (!peerId) {
      return res.status(400).json({ error: "Missing peerId for heartbeat" });
    }

    const nowStr = new Date().toISOString();

    if (!isFallbackMode && supabase) {
      const { error } = await supabase
        .from("room_peers")
        .update({ last_seen: nowStr })
        .eq("room_code", cleanCode)
        .eq("peer_id", peerId);

      if (error) throw error;
      return res.json({ success: true, dbMode: "supabase" });
    }

    // Fallback heartbeat
    const matched = memoryPeers.find(p => p.room_code === cleanCode && p.peer_id === peerId);
    if (matched) {
      matched.last_seen = nowStr;
    }

    return res.json({ success: true, dbMode: "fallback" });

  } catch (error: any) {
    console.error("Heartbeat error:", error);
    res.status(500).json({ error: error.message || "Failed to update heartbeat." });
  }
});

// Delete Peer manually on room exit
app.post("/api/rooms/:roomCode/peers/:peerId/exit", async (req, res) => {
  try {
    const { roomCode, peerId } = req.params;
    const cleanCode = roomCode.toUpperCase();

    if (!isFallbackMode && supabase) {
      const { error } = await supabase
        .from("room_peers")
        .delete()
        .eq("room_code", cleanCode)
        .eq("peer_id", peerId);

      if (error) throw error;
      return res.json({ success: true, dbMode: "supabase" });
    }

    // Fallback purge
    const idx = memoryPeers.findIndex(p => p.room_code === cleanCode && p.peer_id === peerId);
    if (idx >= 0) {
      memoryPeers.splice(idx, 1);
    }

    return res.json({ success: true, dbMode: "fallback" });

  } catch (error: any) {
    console.error("Remove peer error:", error);
    res.status(500).json({ error: "Failed to exit room metadata cleanly." });
  }
});


// ----------------------------------------------------
// BOOTSTRAP INTEGRATION METADATA / STATICS
// ----------------------------------------------------

async function startServer() {
  // Setup Vite Middleware in development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
    console.log("Mounted Vite development middleware client.");
  } else {
    // Serve production static assets compiled inside /dist
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving static production assets from /dist.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`P2P drawing board server running on http://localhost:${PORT}`);
  });
}

// Only start the server if not running in Vercel's serverless environment
if (!process.env.VERCEL) {
  startServer();
}

export default app;
