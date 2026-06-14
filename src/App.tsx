/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import Lobby from "./components/Lobby";
import Board from "./components/Board";

export default function App() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string>("");

  const handleJoinRoom = (code: string, nick: string) => {
    setNickname(nick);
    setRoomCode(code);
  };

  const handleLeaveRoom = () => {
    setRoomCode(null);
  };

  return (
    <div className="min-h-screen w-full bg-[#0d1117] text-slate-100 flex flex-col">
      {roomCode ? (
        <Board 
          roomCode={roomCode} 
          nickname={nickname} 
          onLeave={handleLeaveRoom} 
        />
      ) : (
        <Lobby 
          onJoinRoom={handleJoinRoom} 
          onCreateRoom={(nick) => {
            // Creation logic is managed inside Lobby.tsx forms, triggering onJoinRoom upon success
          }} 
        />
      )}
    </div>
  );
}

