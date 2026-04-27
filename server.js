const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

const rooms = {};

const words = [
  { word: "banan", hint: "żółty owoc" },
  { word: "samochód", hint: "pojazd na kołach" },
  { word: "pies", hint: "szczeka" },
  { word: "szkoła", hint: "uczą się dzieci" }
];

io.on("connection", (socket) => {
  console.log("Nowy gracz:", socket.id);

  // =====================
  // CREATE ROOM
  // =====================
  socket.on("createRoom", (name, cb) => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();

    rooms[code] = {
      hostId: socket.id,
      players: [{ id: socket.id, name }],
      phase: "PLAY",
      round: 0,
      impostorId: null,
      word: "",
      answers: {},
      votes: {}
    };

    socket.join(code);

    cb({
      roomCode: code,
      players: rooms[code].players,
      hostId: socket.id
    });
  });

  // =====================
  // JOIN
  // =====================
  socket.on("joinRoom", ({ roomCode, name }, cb) => {
    const room = rooms[roomCode];
    if (!room) return cb?.({ error: "brak pokoju" });

    room.players.push({ id: socket.id, name });
    socket.join(roomCode);

    io.to(roomCode).emit("updatePlayers", room.players);

    cb?.({
      success: true,
      players: room.players,
      hostId: room.hostId
    });
  });

  // =====================
  // START GAME
  // =====================
  socket.on("startGame", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || socket.id !== room.hostId) return;

    startGame(roomCode);
  });

  // =====================
  // ANSWERS (RUNDA)
  // =====================
  socket.on("message", ({ roomCode, message, name }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "PLAY") return;

    room.answers[socket.id] = message;

    io.to(roomCode).emit("message", { name, message });

    // IMPOSOR WIN (ZGADŁ SŁOWO)
    if (
      socket.id === room.impostorId &&
      message.toLowerCase() === room.word.toLowerCase()
    ) {
      io.to(roomCode).emit("gameEnd", {
        winner: "IMPOSTOR",
        word: room.word
      });

      setTimeout(() => resetGame(roomCode, "IMPOSTOR"), 2000);
      return;
    }

    // CHECK IF ALL ANSWERED
    if (Object.keys(room.answers).length === room.players.length) {
      startVoting(roomCode);
    }
  });

  // =====================
  // VOTING
  // =====================
  socket.on("vote", ({ roomCode, targetId }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "VOTE") return;

    room.votes[socket.id] = targetId;

    const votes = Object.values(room.votes);

    const allVoted = votes.length === room.players.length;

    if (!allVoted) return;

    const counts = {};

    votes.forEach(v => {
      counts[v] = (counts[v] || 0) + 1;
    });

    const max = Math.max(...Object.values(counts));
    const candidates = Object.keys(counts).filter(k => counts[k] === max);

    // brak jednogłośności
    if (candidates.length !== 1) {
      io.to(roomCode).emit("gameEnd", {
        winner: "IMPOSTOR",
        word: room.word
      });

      setTimeout(() => resetGame(roomCode, "IMPOSTOR"), 2000);
      return;
    }

    const votedId = candidates[0];

    const correct = votedId === room.impostorId;

    io.to(roomCode).emit("gameEnd", {
      winner: correct ? "CREWMATES" : "IMPOSTOR",
      word: room.word
    });

    setTimeout(() => resetGame(roomCode, correct ? "CREWMATES" : "IMPOSTOR"), 2000);
  });

  // =====================
  // DISCONNECT
  // =====================
  socket.on("disconnect", () => {
    for (const code in rooms) {
      const r = rooms[code];
      r.players = r.players.filter(p => p.id !== socket.id);
      io.to(code).emit("updatePlayers", r.players);
    }
  });
});


// =====================
// START GAME
// =====================
function startGame(code) {
  const room = rooms[code];

  const w = words[Math.floor(Math.random() * words.length)];

  room.word = w.word;
  room.phase = "PLAY";
  room.answers = {};
  room.votes = {};

  room.round++;

  const impostor = room.players[Math.floor(Math.random() * room.players.length)];
  room.impostorId = impostor.id;

  room.players.forEach(p => {
    io.to(p.id).emit("role", {
      role: p.id === room.impostorId ? "IMPOSTOR" : "CREWMATE",
      hint: w.hint,
      word: w.word
    });
  });

  io.to(code).emit("roundStart", { round: room.round });
}


// =====================
// VOTING PHASE
// =====================
function startVoting(code) {
  const room = rooms[code];
  if (!room) return;

  room.phase = "VOTE";
  room.votes = {};

  io.to(code).emit("voteStart", {
    players: room.players
  });
}


// =====================
// RESET GAME
// =====================
function resetGame(code, result) {
  const room = rooms[code];
  if (!room) return;

  room.phase = "PLAY";
  room.answers = {};
  room.votes = {};

  startGame(code);
}


// =====================
server.listen(3000, () => console.log("OK"));
