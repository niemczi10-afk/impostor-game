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
  socket.on("createRoom", (name, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

    rooms[roomCode] = {
      players: [{ id: socket.id, name }]
    };

    socket.join(roomCode);

    callback({ roomCode, players: rooms[roomCode].players });
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
