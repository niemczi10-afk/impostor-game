const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static("public"));

const rooms = {};

const words = [
  { word: "banan", hint: "żółty owoc" },
  { word: "samochód", hint: "pojazd na kołach" },
  { word: "pies", hint: "szczeka i ma ogon" },
  { word: "szkoła", hint: "uczą się tam dzieci" }
];

io.on("connection", (socket) => {
  console.log("Nowy gracz:", socket.id);

  // =====================
  // CREATE ROOM
  // =====================
  socket.on("createRoom", (name, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name }],
      turnIndex: 0,
      turnOrder: [],
      currentWord: "",
      impostorId: null,
      round: 0
    };

    socket.join(roomCode);

    callback({
      roomCode,
      players: rooms[roomCode].players,
      hostId: socket.id
    });
  });

  // =====================
  // JOIN ROOM
  // =====================
  socket.on("joinRoom", ({ roomCode, name }, callback) => {
    const room = rooms[roomCode];
    if (!room) return callback?.({ error: "Nie ma takiego pokoju" });

    room.players.push({ id: socket.id, name });
    socket.join(roomCode);

    io.to(roomCode).emit("updatePlayers", room.players);

    callback?.({
      success: true,
      players: room.players,
      hostId: room.hostId
    });
  });

  // =====================
  // START GAME (HOST ONLY)
  // =====================
  socket.on("startGame", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    if (socket.id !== room.hostId) return;

    startNewRound(roomCode);
  });

  // =====================
  // MESSAGE
  // =====================
  socket.on("message", ({ roomCode, name, message }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const currentId = room.turnOrder[room.turnIndex];
    if (socket.id !== currentId) return;

    io.to(roomCode).emit("message", { name, message });

    // IMPOSTOR WIN CONDITION
    if (
      socket.id === room.impostorId &&
      message.toLowerCase() === room.currentWord.toLowerCase()
    ) {
      io.to(roomCode).emit("gameEnd", {
        winner: "IMPOSTOR",
        word: room.currentWord
      });

      setTimeout(() => {
        startNewRound(roomCode);
      }, 2000);

      return;
    }

    // NEXT TURN
    room.turnIndex++;
    if (room.turnIndex >= room.turnOrder.length) {
      room.turnIndex = 0;
    }

    sendTurn(roomCode);
  });

  // =====================
  // DISCONNECT
  // =====================
  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      if (!room) continue;

      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit("updatePlayers", room.players);
        sendTurn(roomCode);
      }
    }
  });
});


// =====================
// NEW ROUND
// =====================
function startNewRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  if (room.players.length < 3 || room.players.length > 6) return;

  const randomWord = words[Math.floor(Math.random() * words.length)];
  room.currentWord = randomWord.word;

  const impostorIndex = Math.floor(Math.random() * room.players.length);
  room.impostorId = room.players[impostorIndex].id;

  room.turnOrder = [...room.players]
    .sort(() => Math.random() - 0.5)
    .map(p => p.id);

  room.turnIndex = 0;
  room.round = (room.round || 0) + 1;

  // ROLE SEND
  room.players.forEach((p) => {
    if (p.id === room.impostorId) {
      io.to(p.id).emit("role", {
        role: "IMPOSTOR",
        hint: randomWord.hint
      });
    } else {
      io.to(p.id).emit("role", {
        role: "CREWMATE",
        word: randomWord.word
      });
    }
  });

  io.to(roomCode).emit("roundStart", {
    round: room.round
  });

  sendTurn(roomCode);
}


// =====================
// TURN SYNC
// =====================
function sendTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const currentId = room.turnOrder[room.turnIndex];
  const player = room.players.find(p => p.id === currentId);

  io.to(roomCode).emit("turn", {
    playerId: currentId,
    playerName: player?.name || "?"
  });
}


// =====================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Serwer działa");
});
