import React, { useRef, useEffect, useState } from "react";
import { Peer, DataConnection } from "peerjs";
import { 
  Paintbrush, 
  Eraser, 
  Undo2, 
  Redo2, 
  Trash2, 
  LogOut, 
  Copy, 
  Check, 
  Users, 
  Wifi, 
  WifiOff, 
  CloudCheck, // Wait, cloud icon works better
  CloudLightning,
  RefreshCw,
  Sparkles,
  Database
} from "lucide-react";
import { Point, Stroke, RoomInfo, PeerProfile, DrawingMessage } from "../types";

// Dynamic UUID Generator
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface BoardProps {
  roomCode: string;
  nickname: string;
  onLeave: () => void;
}

// Fixed Virtual Resolution
const VIRTUAL_WIDTH = 1920;
const VIRTUAL_HEIGHT = 1080;

// High contrast palette presets
const COLOR_PRESETS = [
  "#f0f6fc", // White
  "#ff4d4f", // Red
  "#ffc069", // Gold/Orange
  "#52c41a", // Green
  "#1890ff", // Blue
  "#722ed1", // Violet
  "#eb2f96", // Pink
];

export default function Board({ roomCode, nickname, onLeave }: BoardProps) {
  // Canvas & Resize DOM pointers
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Drawing state
  const [currentTool, setCurrentTool] = useState<"pen" | "eraser">("pen");
  const [currentColor, setCurrentColor] = useState("#f0f6fc");
  const [currentBrushSize, setCurrentBrushSize] = useState(4);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<Point[]>([]);

  // Board Data Storage state
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const stridesMapRef = useRef<Set<string>>(new Set()); // Prevents duplicate rendering of strokes
  const [myUndoStack, setMyUndoStack] = useState<string[]>([]);
  const [myRedoStack, setMyRedoStack] = useState<Stroke[]>([]);

  // Status & Room state
  const [roomTitle, setRoomTitle] = useState("");
  const [dbMode, setDbMode] = useState<"supabase" | "fallback">("fallback");
  const [syncState, setSyncState] = useState<"synced" | "saving" | "failed" | "retrying">("synced");
  const [pendingSaves, setPendingSaves] = useState<Stroke[]>([]);
  const [copiedCode, setCopiedCode] = useState(false);

  // Peering & WebRTC state
  const [myPeerId, setMyPeerId] = useState("");
  const [peers, setPeers] = useState<PeerProfile[]>([]);
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());

  // ----------------------------------------------------
  // INITIAL DATA & ROOM INFORMATION RETRIEVE
  // ----------------------------------------------------
  useEffect(() => {
    // 1. Fetch Room Name & Mode
    fetch(`/api/rooms/${roomCode}`)
      .then((res) => {
        if (!res.ok) throw new Error("Room missing.");
        return res.json();
      })
      .then((data: RoomInfo) => {
        setRoomTitle(data.title);
        setDbMode(data.dbMode);
      })
      .catch((err) => {
        setRoomTitle(`Room ${roomCode}`);
        console.error("Error retrieving room title:", err);
      });

    // 2. Fetch Existing Strokes from database
    loadStrokesFromBackend();
  }, [roomCode]);

  const loadStrokesFromBackend = () => {
    fetch(`/api/rooms/${roomCode}/strokes`)
      .then((res) => res.json())
      .then((data) => {
        if (data.strokes) {
          const loadedStrokes: Stroke[] = data.strokes;
          
          // Inject to local state preventing duplicates
          const newStrokesSet = new Set<string>();
          loadedStrokes.forEach((s) => {
            newStrokesSet.add(s.id);
          });
          stridesMapRef.current = newStrokesSet;
          
          setStrokes(loadedStrokes);
        }
      })
      .catch((err) => {
        console.error("Error loading historical strokes:", err);
      });
  };

  // ----------------------------------------------------
  // CANVAS RESPONSIVE DIMENSION & RESOLUTION CONFIG
  // ----------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const container = containerRef.current;
      if (!container || !canvas) return;

      const rect = container.getBoundingClientRect();
      const devicePixelRatio = window.devicePixelRatio || 1;

      // Set physical buffer size scaled by device pixel ratio
      canvas.width = rect.width * devicePixelRatio;
      canvas.height = rect.height * devicePixelRatio;

      // Set CSS scaling style
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      // Scale canvas rendering context matches high density scaling
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.resetTransform();
        ctx.scale(devicePixelRatio, devicePixelRatio);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }

      // Re-trigger full redraw
      triggerRedraw();
    };

    // Responsive setup via ResizeObserver
    const observer = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    // Set initial size
    handleResize();

    return () => {
      observer.disconnect();
    };
  }, [strokes]); // Re-draw and resize properly upon strokes array changes

  // Coordinate projection ratios mapper
  const getCoordinatesRatio = (clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = VIRTUAL_WIDTH / rect.width;
    const scaleY = VIRTUAL_HEIGHT / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const projectToDisplayCoords = (point: Point): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / VIRTUAL_WIDTH;
    const scaleY = rect.height / VIRTUAL_HEIGHT;

    return {
      x: point.x * scaleX,
      y: point.y * scaleY,
    };
  };

  // ----------------------------------------------------
  // PEERJS WEBRTC P2P SIGNALING & HEARTBEAT LOBBY
  // ----------------------------------------------------
  useEffect(() => {
    // Instantiate PeerJS
    const peer = new Peer(undefined, {
      debug: 1,
    });
    peerRef.current = peer;

    // Handle open signaling
    peer.on("open", (id) => {
      setMyPeerId(id);
      
      // Register in Database roster
      registerInRoster(id);

      // Start ping heartbeat interval
      const heartbeatTimer = setInterval(() => {
        sendHeartbeat(id);
      }, 10000);

      // Discover peers & build mesh connections
      discoverPeersAndConnect(id);

      return () => {
        clearInterval(heartbeatTimer);
      };
    });

    // Handle inbound peer connections
    peer.on("connection", (conn) => {
      setupConnectionListeners(conn);
    });

    // Tear down connections on unmount
    return () => {
      // Send exit notice
      if (peerRef.current) {
        fetch(`/api/rooms/${roomCode}/peers/${peerRef.current.id}/exit`, { method: "POST" })
          .catch((e) => console.log("Failed to exit database cleanly", e));
      }

      connectionsRef.current.forEach((conn) => {
        conn.close();
      });
      peer.destroy();
    };
  }, []);

  const registerInRoster = (peerId: string) => {
    fetch(`/api/rooms/${roomCode}/peers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peerId, nickname }),
    }).catch((e) => console.warn("Failed to join database peer list:", e));
  };

  const sendHeartbeat = (peerId: string) => {
    fetch(`/api/rooms/${roomCode}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peerId }),
    }).catch((e) => console.warn("Heartbeat update failed:", e));
  };

  const discoverPeersAndConnect = (myId: string) => {
    fetch(`/api/rooms/${roomCode}/peers`)
      .then((res) => res.json())
      .then((data) => {
        if (data.peers) {
          const peersList: PeerProfile[] = data.peers;
          
          // Exclude ourselves
          const filtered = peersList.filter((p) => p.peer_id !== myId);
          setPeers(filtered);

          // Connect to each active peer
          filtered.forEach((p) => {
            // Guarantee we don't connect twice
            if (!connectionsRef.current.has(p.peer_id)) {
              const conn = peerRef.current?.connect(p.peer_id, {
                metadata: { nickname }, // Handshake display name
              });
              if (conn) {
                setupConnectionListeners(conn);
              }
            }
          });
        }
      })
      .catch((e) => console.error("Error polling peer discoveries:", e));
  };

  // Setup heartbeat checks (every 12 seconds check for any newly arrived participants)
  useEffect(() => {
    if (!myPeerId) return;

    const rosterPoll = setInterval(() => {
      discoverPeersAndConnect(myPeerId);
    }, 12000);

    return () => clearInterval(rosterPoll);
  }, [myPeerId]);

  const setupConnectionListeners = (conn: DataConnection) => {
    connectionsRef.current.set(conn.peer, conn);

    conn.on("open", () => {
      // Connect status updated, fetch immediate roster in state
      const connNick = conn.metadata?.nickname || "Companion";
      
      setPeers((prev) => {
        const found = prev.find((p) => p.peer_id === conn.peer);
        if (found) {
          return prev;
        }
        return [...prev, { peer_id: conn.peer, nickname: connNick }];
      });
    });

    conn.on("data", (data: any) => {
      const msg: DrawingMessage = data as DrawingMessage;
      if (msg.roomCode !== roomCode) return;

      switch (msg.type) {
        case "STROKE_ADD":
          if (msg.stroke) {
            applyRemoteStroke(msg.stroke);
          }
          break;

        case "CLEAR_CANVAS":
          applyRemoteClear();
          break;

        case "UNDO":
          if (msg.strokeId) {
            applyRemoteUndo(msg.strokeId);
          }
          break;

        case "REDO":
          if (msg.stroke) {
            applyRemoteRedo(msg.stroke);
          }
          break;
      }
    });

    conn.on("close", () => {
      connectionsRef.current.delete(conn.peer);
      // Remove peer profile
      setPeers((prev) => prev.filter((p) => p.peer_id !== conn.peer));
    });

    conn.on("error", (err) => {
      console.warn("Peering connection error:", err);
      connectionsRef.current.delete(conn.peer);
      setPeers((prev) => prev.filter((p) => p.peer_id !== conn.peer));
    });
  };

  const broadcastMessage = (msg: DrawingMessage) => {
    connectionsRef.current.forEach((conn) => {
      if (conn.open) {
        conn.send(msg);
      }
    });
  };

  // ----------------------------------------------------
  // DRAWING CANVAS INPUT HANDLERS
  // ----------------------------------------------------
  const handleStartDraw = (clientX: number, clientY: number) => {
    isDrawingRef.current = true;
    const pt = getCoordinatesRatio(clientX, clientY);
    currentPointsRef.current = [pt];
    
    // Draw direct indicator dot
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const screenPt = projectToDisplayCoords(pt);
        ctx.beginPath();
        ctx.fillStyle = currentTool === "eraser" ? "#0d1117" : currentColor;
        ctx.arc(
          screenPt.x,
          screenPt.y,
          currentTool === "eraser" ? currentBrushSize * 2 : currentBrushSize / 2,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  };

  const handleDragDraw = (clientX: number, clientY: number) => {
    if (!isDrawingRef.current) return;

    const pt = getCoordinatesRatio(clientX, clientY);
    const lastPt = currentPointsRef.current[currentPointsRef.current.length - 1];

    // Smooth drawing if the drag exceeds a tiny threshold limit
    if (lastPt) {
      const dist = Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y);
      if (dist < 1.0) return; // Ignore micro jitterings
    }

    currentPointsRef.current.push(pt);

    // Draw the segment locally in real-time
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx && lastPt) {
        const p1 = projectToDisplayCoords(lastPt);
        const p2 = projectToDisplayCoords(pt);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = currentTool === "eraser" ? "#0d1117" : currentColor;
        ctx.lineWidth = currentTool === "eraser" ? currentBrushSize * 4 : currentBrushSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    }
  };

  const handleEndDraw = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const strokePoints = currentPointsRef.current;
    if (strokePoints.length === 0) return;

    // Create completed stroke model
    const strokeId = generateUUID();
    const newStroke: Stroke = {
      id: strokeId,
      room_code: roomCode,
      user_id: myPeerId || "local",
      tool: currentTool,
      color: currentColor,
      size: currentTool === "eraser" ? currentBrushSize * 4 : currentBrushSize,
      points: strokePoints,
    };

    // Update state prevent double register
    stridesMapRef.current.add(strokeId);
    setStrokes((prev) => [...prev, newStroke]);
    
    // Add to undo registry stack
    setMyUndoStack((prev) => [...prev, strokeId]);
    setMyRedoStack([]); // Clear redo stack on manual drawing

    // 1. Broadcast to WebRTC peers
    broadcastMessage({
      type: "STROKE_ADD",
      roomCode,
      stroke: newStroke,
    });

    // 2. Persist in Database Server
    saveStrokeToServer(newStroke);
  };

  // ----------------------------------------------------
  // PERSISTENCE SYNC & RETRY ENGINE
  // ----------------------------------------------------
  const saveStrokeToServer = (stroke: Stroke) => {
    setSyncState("saving");
    fetch(`/api/rooms/${roomCode}/strokes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stroke),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Save status not ok.");
        return res.json();
      })
      .then(() => {
        setSyncState("synced");
      })
      .catch((err) => {
        console.warn("Failed saving drawing data, queuing retry:", err);
        setSyncState("failed");
        setPendingSaves((prev) => [...prev, stroke]);
      });
  };

  // Retrier loop coordinates
  useEffect(() => {
    if (pendingSaves.length === 0) return;

    const timer = setTimeout(() => {
      setSyncState("retrying");
      const nextStroke = pendingSaves[0];

      fetch(`/api/rooms/${roomCode}/strokes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextStroke),
      })
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then(() => {
          setPendingSaves((prev) => prev.slice(1));
          setSyncState(pendingSaves.length > 1 ? "saving" : "synced");
        })
        .catch(() => {
          setSyncState("failed");
          // Stays in queue, will retry again on next tick
        });
    }, 5000);

    return () => clearTimeout(timer);
  }, [pendingSaves, roomCode]);

  // ----------------------------------------------------
  // COLLABORATION AND PEER EVENTS BROADCAST CODES
  // ----------------------------------------------------
  const applyRemoteStroke = (stroke: Stroke) => {
    if (stridesMapRef.current.has(stroke.id)) return; // duplicate protection
    stridesMapRef.current.add(stroke.id);
    setStrokes((prev) => [...prev, stroke]);
  };

  const handleLocalUndo = () => {
    if (myUndoStack.length === 0) return;
    
    // Select last stroke drawn by myself
    const lastMyStrokeId = myUndoStack[myUndoStack.length - 1];
    const removedStroke = strokes.find((s) => s.id === lastMyStrokeId);
    
    if (!removedStroke) return;

    // Transition state
    setMyUndoStack((prev) => prev.slice(0, -1));
    setMyRedoStack((prev) => [...prev, removedStroke]);

    // Update strokes locally (soft delete locally first)
    setStrokes((prev) => prev.filter((s) => s.id !== lastMyStrokeId));
    stridesMapRef.current.delete(lastMyStrokeId);

    // Call WebRTC broadcast
    broadcastMessage({
      type: "UNDO",
      roomCode,
      strokeId: lastMyStrokeId,
    });

    // Notify backend
    fetch(`/api/rooms/${roomCode}/strokes/${lastMyStrokeId}/undo`, {
      method: "POST",
    }).catch((e) => console.warn("Failed syncing remote undo delete:", e));
  };

  const applyRemoteUndo = (strokeId: string) => {
    setStrokes((prev) => prev.filter((s) => s.id !== strokeId));
    stridesMapRef.current.delete(strokeId);
  };

  const handleLocalRedo = () => {
    if (myRedoStack.length === 0) return;

    const restoredStroke = myRedoStack[myRedoStack.length - 1];
    setMyRedoStack((prev) => prev.slice(0, -1));
    setMyUndoStack((prev) => [...prev, restoredStroke.id]);

    stridesMapRef.current.add(restoredStroke.id);
    setStrokes((prev) => [...prev, restoredStroke]);

    // Broadcast
    broadcastMessage({
      type: "REDO",
      roomCode,
      stroke: restoredStroke,
    });

    // Sync database
    fetch(`/api/rooms/${roomCode}/strokes/${restoredStroke.id}/redo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: restoredStroke.user_id,
        tool: restoredStroke.tool,
        color: restoredStroke.color,
        size: restoredStroke.size,
        points: restoredStroke.points,
      }),
    }).catch((e) => console.warn("Redo sync failure:", e));
  };

  const applyRemoteRedo = (stroke: Stroke) => {
    if (stridesMapRef.current.has(stroke.id)) return;
    stridesMapRef.current.add(stroke.id);
    setStrokes((prev) => [...prev, stroke]);
  };

  const handleLocalClear = () => {
    if (strokes.length === 0) return;
    if (!window.confirm("Are you sure you want to clean the drawing board for everyone?")) return;

    setStrokes([]);
    stridesMapRef.current.clear();
    setMyUndoStack([]);
    setMyRedoStack([]);

    // Broadcast clearance
    broadcastMessage({
      type: "CLEAR_CANVAS",
      roomCode,
    });

    // Persist soft delete on Server
    fetch(`/api/rooms/${roomCode}/clear`, {
      method: "POST",
    }).catch((e) => console.warn("Database clear failed:", e));
  };

  const applyRemoteClear = () => {
    setStrokes([]);
    stridesMapRef.current.clear();
    // Flush remote queues
    setMyUndoStack([]);
    setMyRedoStack([]);
  };

  // ----------------------------------------------------
  // MASTER REDRAW LOGIC (Renders state arrays perfectly)
  // ----------------------------------------------------
  const triggerRedraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear board display
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Loop through strokes sequentially
    strokes.forEach((stroke) => {
      const points = stroke.points;
      if (!points || points.length === 0) return;

      ctx.beginPath();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Re-projection mapping
      const pFirst = projectToDisplayCoords(points[0]);
      
      if (points.length === 1) {
        // Draw standalone spot
        ctx.fillStyle = stroke.tool === "eraser" ? "#0d1117" : stroke.color;
        ctx.arc(pFirst.x, pFirst.y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(pFirst.x, pFirst.y);
        for (let i = 1; i < points.length; i++) {
          const pNext = projectToDisplayCoords(points[i]);
          ctx.lineTo(pNext.x, pNext.y);
        }
        ctx.strokeStyle = stroke.tool === "eraser" ? "#0d1117" : stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.stroke();
      }
    });
  };

  // Redraw canvas every time the stroke array changes
  useEffect(() => {
    triggerRedraw();
  }, [strokes]);

  // ----------------------------------------------------
  // UTILITY CONTROLS
  // ----------------------------------------------------
  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Export board as PNG
  const exportBoardAsPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      // Create a virtual high-density canvas containing a solid backdrop matching our dark board theme
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");

      if (tempCtx) {
        // Background paint
        tempCtx.fillStyle = "#0d1117";
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Overlay our actual painted pixels
        tempCtx.drawImage(canvas, 0, 0);

        // Formulate downloader link
        const imgURL = tempCanvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.href = imgURL;
        downloadLink.download = `p2p_board_${roomCode}_sketch.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      }
    } catch (e) {
      console.error("Export failed:", e);
      alert("Failed to export image due to canvas rendering security restrictions.");
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0b0e14] overflow-hidden text-slate-100 font-sans">
      
      {/* ========================================== */}
      {/* TOP HEADER STUDIO BAR */}
      {/* ========================================== */}
      <header className="px-6 py-4 bg-[#0d121c] border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 select-none shrink-0 relative z-30">
        
        {/* ROOM DETAILS METADATA */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 rounded-lg text-indigo-400">
            <Paintbrush className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-slate-100 max-w-[140px] truncate md:max-w-[200px]" title={roomTitle}>
              {roomTitle || "Dynamic Canvas"}
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-slate-400 font-medium">CODE:</span>
              <button 
                onClick={copyRoomCode} 
                className="group flex items-center gap-1 bg-slate-950/60 hover:bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-xs font-mono text-indigo-300 hover:text-white transition-colors cursor-pointer"
              >
                <span>{roomCode}</span>
                {copiedCode ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* BRUSH STYLING CONTROLS */}
        <div className="flex items-center gap-3 bg-slate-900/50 p-1.5 rounded-xl border border-slate-800/80">
          
          {/* BRUSH / ERASER SELECTOR */}
          <div className="flex bg-slate-950/80 p-1 rounded-lg border border-slate-800 shrink-0">
            <button
              onClick={() => setCurrentTool("pen")}
              className={`p-1.5 rounded-md flex items-center gap-1 cursor-pointer transition-colors ${currentTool === "pen" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
              title="Pen Brush"
            >
              <Paintbrush className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentTool("eraser")}
              className={`p-1.5 rounded-md flex items-center gap-1 cursor-pointer transition-colors ${currentTool === "eraser" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
              title="Eraser Tip"
            >
              <Eraser className="w-4 h-4" />
            </button>
          </div>

          {/* PALETTE PICKS (Only visible if Pen tool selected) */}
          {currentTool === "pen" && (
            <div className="hidden md:flex items-center gap-1.5 px-1 bg-slate-950/40 py-1.5 rounded-lg border border-slate-800/40">
              {COLOR_PRESETS.map((col) => (
                <button
                  key={col}
                  onClick={() => setCurrentColor(col)}
                  style={{ backgroundColor: col }}
                  className={`w-5 h-5 rounded-full border-2 transition-all cursor-pointer ${currentColor === col ? "border-indigo-400 scale-110 ring-4 ring-indigo-500/10" : "border-transparent hover:scale-105"}`}
                />
              ))}
              <div className="w-px h-4 bg-slate-800 mx-1" />
              {/* HTML Native Custom Color Picker */}
              <div className="relative w-6 h-6 rounded-full overflow-hidden border border-slate-700 cursor-pointer hover:border-slate-400 shrink-0">
                <input
                  type="color"
                  value={currentColor}
                  onChange={(e) => setCurrentColor(e.target.value)}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  title="Custom pick"
                />
                <div 
                  className="w-full h-full rounded-full" 
                  style={{ background: `linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(0,0,0,0.4) 100%), ${currentColor}` }} 
                />
              </div>
            </div>
          )}

          {/* SIZE ADJUSTER SLIDER */}
          <div className="flex items-center gap-2 px-3">
            <span className="text-[10px] uppercase font-bold text-slate-500">Size</span>
            <input
              type="range"
              min={1}
              max={25}
              value={currentBrushSize}
              onChange={(e) => setCurrentBrushSize(parseInt(e.target.value))}
              className="w-20 md:w-28 accent-indigo-500 cursor-pointer py-1"
            />
            <span className="text-xs font-mono text-slate-400 shrink-0 w-5">
              {currentBrushSize}px
            </span>
          </div>
        </div>

        {/* WORKSPACE OPERATIONS BUTTON PANEL */}
        <div className="flex items-center gap-2">
          {/* UNDO / REDO */}
          <div className="flex bg-slate-900/50 p-1 border border-slate-800/80 rounded-lg">
            <button
              onClick={handleLocalUndo}
              disabled={myUndoStack.length === 0}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed transition-colors"
              title="Undo my stroke"
            >
              <Undo2 className="w-5.5 h-5.5" />
            </button>
            <button
              onClick={handleLocalRedo}
              disabled={myRedoStack.length === 0}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed transition-colors"
              title="Redo stroke"
            >
              <Redo2 className="w-5.5 h-5.5" />
            </button>
          </div>

          <div className="w-px h-6 bg-slate-800" />

          {/* EXPORT OPTIONS */}
          <button
            onClick={exportBoardAsPNG}
            disabled={strokes.length === 0}
            className="text-xs font-semibold bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 disabled:opacity-30 px-3 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed transition-all"
            title="Export full board draft as high resolution PNG"
          >
            <span>PNG</span>
          </button>

          {/* CLEAR BOARD */}
          <button
            onClick={handleLocalClear}
            disabled={strokes.length === 0}
            className="p-2 rounded-xl bg-rose-950/20 hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 border border-rose-900/20 flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
            title="Clear board coordinates"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* QUIT ROOM */}
          <button
            onClick={onLeave}
            className="ml-2 bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white font-medium text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-lg shadow-rose-900/10 active:scale-[0.98] transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Leave</span>
          </button>
        </div>
      </header>

      {/* ========================================== */}
      {/* CENTRAL VISUAL DRAWING AREA */}
      {/* ========================================== */}
      <main className="flex-1 w-full bg-[#0d1117] relative select-none cursor-crosshair overflow-hidden">
        
        {/* Dynamic Background Grid Pattern overlay */}
        <div className="absolute inset-0 bg-[#0d1117] bg-[linear-gradient(to_right,#1f293708_1px,transparent_1px),linear-gradient(to_bottom,#1f293708_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

        {/* RENDER CANVAS CONTAINER */}
        <div 
          ref={containerRef} 
          className="w-full h-full p-2 relative flex justify-center items-center"
        >
          <canvas
            ref={canvasRef}
            onMouseDown={(e) => {
              if (e.button !== 0) return; // Only process left click mouse
              handleStartDraw(e.clientX, e.clientY);
            }}
            onMouseMove={(e) => {
              handleDragDraw(e.clientX, e.clientY);
            }}
            onMouseUp={handleEndDraw}
            onMouseLeave={handleEndDraw}
            
            // Mobile Touch Events mapping
            onTouchStart={(e) => {
              if (e.touches.length === 1) {
                const touch = e.touches[0];
                handleStartDraw(touch.clientX, touch.clientY);
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 1) {
                const touch = e.touches[0];
                handleDragDraw(touch.clientX, touch.clientY);
              }
            }}
            onTouchEnd={handleEndDraw}
            className="bg-slate-950/80 rounded-2xl border border-slate-800 shadow-2xl transition-shadow backdrop-blur-sm"
          />
        </div>

        {/* ========================================== */}
        {/* ROSTER HUD OVERLAYS */}
        {/* ========================================== */}
        
        {/* PEER ROSTER WIDGET (LEFT CORNER) */}
        <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-2 pointer-events-none max-w-sm">
          
          {/* USER COUNT ACCORDION */}
          <div className="bg-slate-900/80 backdrop-blur-md px-4 py-3 border border-slate-800 rounded-2xl flex flex-col gap-2.5 shadow-xl max-w-[240px] pointer-events-auto">
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2">
              <div className="p-1 px-2 bg-indigo-500/10 text-indigo-400 rounded-md text-[10px] font-bold tracking-wider flex items-center gap-1 shrink-0">
                <Users className="w-3 h-3" />
                <span>{peers.length + 1}</span>
              </div>
              <span className="text-xs font-bold text-slate-300 font-display">Active Collaborators</span>
            </div>

            <ul className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
              {/* OURSELVES */}
              <li className="flex items-center gap-2 text-xs">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500"></span>
                </span>
                <span className="text-slate-200 font-medium truncate" title={`${nickname} (You)`}>
                  {nickname} <span className="text-[10px] text-indigo-400">(You)</span>
                </span>
              </li>

              {/* CO-PEERS LIST */}
              {peers.map((p) => (
                <li key={p.peer_id} className="flex items-center gap-2 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-slate-300 truncate" title={p.nickname}>
                    {p.nickname}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* DATABASE SYNC STATUS WIDGET (RIGHT CORNER) */}
        <div className="absolute bottom-6 right-6 z-20 pointer-events-none flex flex-col gap-2">
          
          {/* SYNC METRIC */}
          <div className="bg-slate-900/80 backdrop-blur-md px-4 py-2.5 border border-slate-800 rounded-2xl shadow-xl flex items-center gap-3 text-xs pointer-events-auto select-none">
            
            {/* Direct icons mapping standard */}
            {syncState === "synced" && (
              <div className="flex items-center gap-2 text-emerald-400 font-semibold font-mono text-[11px]">
                <Wifi className="w-4 h-4 animate-pulse text-emerald-400 shrink-0" />
                <span>SAVED & BROADCASTING</span>
              </div>
            )}

            {syncState === "saving" && (
              <div className="flex items-center gap-2 text-amber-400 font-semibold font-mono text-[11px]">
                <RefreshCw className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                <span>SAVING STROKE DRAFT...</span>
              </div>
            )}

            {syncState === "failed" && (
              <div className="flex items-center gap-2 text-rose-400 font-semibold font-mono text-[11px]">
                <WifiOff className="w-4 h-4 text-rose-500 shrink-0" />
                <span>SAVE FAILED. QUEUING RETRY ({pendingSaves.length} PENDING)</span>
              </div>
            )}

            {syncState === "retrying" && (
              <div className="flex items-center gap-2 text-sky-400 font-semibold font-mono text-[11px]">
                <RefreshCw className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
                <span>CONN LOST. RETRYING AUTOSAVE...</span>
              </div>
            )}

            <div className="w-px h-4 bg-slate-800" />

            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium font-mono uppercase bg-slate-950/50 py-0.5 px-2 rounded border border-slate-800">
              <Database className="w-3" />
              <span>{dbMode === "supabase" ? "Supabase Active" : "In-Memory fallback"}</span>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
