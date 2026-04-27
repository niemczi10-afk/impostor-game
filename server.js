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
  console.log("user:", socket.id);

  // CREATE ROOM
  socket.on("createRoom", (name, cb) => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();

    rooms[code] = {
      hostId: socket.id,
      players: [{ id: socket.id, name }],
      phase: "WAIT",
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

    io.to(code).emit("updatePlayers", rooms[code].players);
  });

  // JOIN ROOM
  socket.on("joinRoom", ({ roomCode, name }, cb) => {
    const room = rooms[roomCode];
    if (!room) return cb?.({ error: "brak pokoju" });

    room.players.push({ id: socket.id, name });
    socket.join(roomCode);

    cb?.({
      success: true,
      players: room.players,
      hostId: room.hostId
    });

    io.to(roomCode).emit("updatePlayers", room.players);
  });

  // START GAME
  socket.on("startGame", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || socket.id !== room.hostId) return;

    startGame(roomCode);
  });

  // MESSAGE (RUNDA)
  socket.on("message", ({ roomCode, message, name }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "PLAY") return;

    room.answers[socket.id] = message;

    io.to(roomCode).emit("message", { name, message });

    // IMP WIN
    if (
      socket.id === room.impostorId &&
      message.toLowerCase() === room.word.toLowerCase()
    ) {
      io.to(roomCode).emit("gameEnd", {
        winner: "IMPOSTOR",
        word: room.word
      });

      setTimeout(() => startGame(roomCode), 2000);
      return;
    }

    // ALL ANSWERED -> VOTE
    if (Object.keys(room.answers).length === room.players.length) {
      startVote(roomCode);
    }
  });

  // VOTE
  socket.on("vote", ({ roomCode, targetId }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== "VOTE") return;

    room.votes[socket.id] = targetId;

    const allVoted =
      Object.keys(room.votes).length === room.players.length;

    if (!allVoted) return;

    const counts = {};
    Object.values(room.votes).forEach(v => {
      counts[v] = (counts[v] || 0) + 1;
    });

    const max = Math.max(...Object.values(counts));
    const winners = Object.keys(counts).filter(k => counts[k] === max);

    // brak jednoznaczności = impostor win
    if (winners.length !== 1) {
      io.to(roomCode).emit("gameEnd", {
        winner: "IMPOSTOR",
        word: room.word
      });

      setTimeout(() => startGame(roomCode), 2000);
      return;
    }

    const voted = winners[0];
    const correct = voted === room.impostorId;

    io.to(roomCode).emit("gameEnd", {
      winner: correct ? "CREWMATES" : "IMPOSTOR",
      word: room.word
    });

    setTimeout(() => startGame(roomCode), 2000);
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    for (const code in rooms) {
      const r = rooms[code];

      r.players = r.players.filter(p => p.id !== socket.id);

      if (r.players.length === 0) delete rooms[code];
      else io.to(code).emit("updatePlayers", r.players);
    }
  });
});


// =====================
// START GAME
// =====================
function startGame(code) {
  const room = rooms[code];
  if (!room) return;

  const w = words[Math.floor(Math.random() * words.length)];

  room.word = w.word;
  room.phase = "PLAY";
  room.answers = {};
  room.votes = {};
  room.round++;

  const impostor =
    room.players[Math.floor(Math.random() * room.players.length)];

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
// VOTE START
// =====================
function startVote(code) {
  const room = rooms[code];
  if (!room) return;

  room.phase = "VOTE";
  room.votes = {};

  io.to(code).emit("voteStart", {
    players: room.players
  });
}


// =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("OK"));
