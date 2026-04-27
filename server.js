const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// 🔥 TO JEST KLUCZ
app.use(express.static("public"));

const rooms = {};

io.on("connection", (socket) => {
  console.log("Nowy gracz:", socket.id);

  // CREATE ROOM
socket.on("startGame", (roomCode, callback) => {
  const room = rooms[roomCode];
  if (!room) return;

  if (room.players.length < 3) {
    return callback({ error: "Minimum 3 graczy" });
  }

  if (room.players.length > 6) {
    return callback({ error: "Maksymalnie 6 graczy" });
  }

  const randomWord = words[Math.floor(Math.random() * words.length)];

  const impostorIndex = Math.floor(Math.random() * room.players.length);
  const impostorId = room.players[impostorIndex].id;

  room.players.forEach((p) => {
    if (p.id === impostorId) {
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

  io.to(roomCode).emit("gameStarted");
});

  // JOIN ROOM
  socket.on("joinRoom", ({ roomCode, name }, callback) => {
    const room = rooms[roomCode];

    if (!room) {
      return callback({ error: "Nie ma takiego pokoju" });
    }

    room.players.push({ id: socket.id, name });
    socket.join(roomCode);

    io.to(roomCode).emit("updatePlayers", room.players);

    callback({ success: true, players: room.players });
  });

  // CHAT
  socket.on("message", ({ roomCode, name, message }) => {
    io.to(roomCode).emit("message", { name, message });
  });

  const words = [
    { word: "banan", hint: "żółty owoc" },
    { word: "samochód", hint: "pojazd na kołach" },
    { word: "pies", hint: "szczeka i ma ogon" },
    { word: "szkoła", hint: "uczą się tam dzieci" }
  ];
  
  // DISCONNECT
  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      rooms[roomCode].players = rooms[roomCode].players.filter(
        p => p.id !== socket.id
      );

      io.to(roomCode).emit("updatePlayers", rooms[roomCode].players);
    }
  });
});

server.listen(3000, () => {
  console.log("Serwer działa na http://localhost:3000");
});
