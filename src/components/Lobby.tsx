import React, { useState, useEffect } from "react";
import { Paintbrush, ArrowRight, User, PlusCircle, LogIn, AlertCircle, RefreshCw } from "lucide-react";

interface LobbyProps {
  onJoinRoom: (roomCode: string, nickname: string) => void;
  onCreateRoom: (nickname: string, customTitle?: string) => void;
}

export default function Lobby({ onJoinRoom, onCreateRoom }: LobbyProps) {
  const [nickname, setNickname] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [serverStatus, setServerStatus] = useState<{ dbMode: string; fallbackReason: string } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Load persisted nickname from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("p2p_nickname");
    if (saved) {
      setNickname(saved);
    }
    checkBackendStatus();
  }, []);

  const checkBackendStatus = async () => {
    setCheckingStatus(true);
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data = await res.json();
        setServerStatus({
          dbMode: data.dbMode,
          fallbackReason: data.fallbackReason
        });
      }
    } catch (e) {
      console.warn("Could not reach backend health status.", e);
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleNicknameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim().substring(0, 16);
    setNickname(val);
    localStorage.setItem("p2p_nickname", val);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (!nickname) {
      setErrorMessage("Please enter a nickname first.");
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: customTitle, nickname })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Room generation failed.");
      }

      const data = await res.json();
      onJoinRoom(data.roomCode, nickname);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to contact database to create room.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (!nickname) {
      setErrorMessage("Please enter a nickname first.");
      return;
    }

    if (!roomCodeInput) {
      setErrorMessage("Please enter a 6-digit room code.");
      return;
    }

    const cleanCode = roomCodeInput.toUpperCase().trim();
    if (cleanCode.length !== 6) {
      setErrorMessage("Room code must be exactly 6 characters.");
      return;
    }

    setIsJoining(true);
    try {
      const res = await fetch(`/api/rooms/${cleanCode}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Room ${cleanCode} not found.`);
      }

      onJoinRoom(cleanCode, nickname);
    } catch (err: any) {
      setErrorMessage(err.message || `No room exists with code ${cleanCode}`);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div id="lobby-screen" className="min-h-screen flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden bg-gradient-to-b from-[#0e1624] via-[#090d16] to-[#04060b]">
      {/* Visual Ambient Light Effect */}
      <div className="absolute top-[-10%] left-[-20%] w-[60%] h-[60%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-20%] w-[60%] h-[60%] rounded-full bg-violet-600/10 blur-[120px] pointer-events-none" />

      {/* Main Hub */}
      <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 p-8 shadow-2xl relative z-10">
        
        {/* Header Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="p-3 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl shadow-lg ring-4 ring-indigo-500/15 mb-4">
            <Paintbrush className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold font-display tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            P2P Canvas Board
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-[280px]">
            Real-time peer-to-peer collaborative sketching board with persistent stores
          </p>
        </div>

        {/* Database mode pill indicators */}
        <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 mb-6 text-xs">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${serverStatus?.dbMode === "supabase" ? "bg-emerald-400" : "bg-sky-400"}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${serverStatus?.dbMode === "supabase" ? "bg-emerald-500" : "bg-sky-500"}`}></span>
            </span>
            <span className="text-slate-300 font-medium">
              {serverStatus?.dbMode === "supabase" ? "Persistent Supabase DB" : "In-Memory Session Storage"}
            </span>
          </div>
          <button
            onClick={checkBackendStatus}
            disabled={checkingStatus}
            className="p-1 hover:bg-slate-800 rounded-md transition-colors text-slate-500 hover:text-slate-300 disabled:opacity-40"
            title="Refresh status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingStatus ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Dynamic warning banner if tables missing */}
        {serverStatus?.fallbackReason && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-6 text-amber-200/95 flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              <strong>Local Fallback Active:</strong> {serverStatus.fallbackReason}
            </span>
          </div>
        )}

        {/* Form elements */}
        <div className="space-y-6">
          {/* USER NICKNAME */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Your Display Name
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-500">
                <User className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Enter nickname..."
                value={nickname}
                onChange={handleNicknameChange}
                className="w-full bg-slate-950/50 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl py-2.5 pl-10 pr-4 text-slate-100 placeholder-slate-600 text-sm focus:outline-none transition-all"
              />
            </div>
          </div>

          {/* Error Message Box */}
          {errorMessage && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-start gap-2 animate-fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* DIVIDER ACCORDION CARDS */}
          <div className="pt-2 border-t border-slate-800/80 space-y-4">
            
            {/* OPTION 1: CREATE ROOM */}
            <form onSubmit={handleCreate} className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Create a New Room
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Board Name (Optional, e.g. Sketchpad)"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value.substring(0, 30))}
                  className="flex-1 bg-slate-950/30 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-2 px-3 text-slate-100 placeholder-slate-600 text-xs focus:outline-none transition-all"
                />
                <button
                  type="submit"
                  disabled={isCreating || isJoining || !nickname}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-medium text-white px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed shrink-0 transition-colors shadow-lg shadow-indigo-600/10 active:scale-[0.98]"
                >
                  {isCreating ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PlusCircle className="w-3.5 h-3.5" />
                  )}
                  Create
                </button>
              </div>
            </form>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-slate-800/60"></div>
              <span className="flex-shrink mx-4 text-slate-600 text-[10px] uppercase font-bold tracking-widest">or</span>
              <div className="flex-grow border-t border-slate-800/60"></div>
            </div>

            {/* OPTION 2: JOIN EXISTING ROOM */}
            <form onSubmit={handleJoin} className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Join Active Room
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Enter 6-digit Code (e.g., A8K2QZ)"
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase().trim())}
                  className="flex-1 bg-slate-950/30 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-2 px-4 text-slate-100 placeholder-slate-600 text-sm tracking-widest font-mono text-center focus:outline-none transition-all"
                />
                <button
                  type="submit"
                  disabled={isCreating || isJoining || !nickname || !roomCodeInput}
                  className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-xs font-medium text-white px-4 py-2.5 rounded-xl flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed shrink-0 transition-colors active:scale-[0.98]"
                >
                  {isJoining ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LogIn className="w-3.5 h-3.5" />
                  )}
                  Join Room
                </button>
              </div>
            </form>

          </div>
        </div>
      </div>

      {/* Footer Branding */}
      <div className="mt-8 text-center text-slate-600 text-xs relative z-10 flex flex-col items-center gap-1">
        <span>No proprietary third-party signaling setups required!</span>
        <span>Securely coordinates peering directly inside web browsers.</span>
      </div>
    </div>
  );
}
