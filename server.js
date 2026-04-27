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

  // CREATE ROOM
  socket.on("createRoom", (name, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

    rooms[roomCode] = {
      players: [{ id: socket.id, name }],
      turnIndex: 0,
      turnOrder: [],
      currentWord: "",
      impostorId: null,
      history: []
    };

    socket.join(roomCode);

    callback({ roomCode, players: rooms[roomCode].players });
  });

  // JOIN ROOM
  socket.on("joinRoom", ({ roomCode, name }, callback) => {
    const room = rooms[roomCode];
    if (!room) return callback?.({ error: "Nie ma takiego pokoju" });

    room.players.push({ id: socket.id, name });
    socket.join(roomCode);

    io.to(roomCode).emit("updatePlayers", room.players);
    callback?.({ success: true, players: room.players });
  });

  // START GAME / NEW ROUND
  socket.on("startGame", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.players.length < 3 || room.players.length > 6) {
      return;
    }

    // LOSOWE SŁOWO
    const randomWord = words[Math.floor(Math.random() * words.length)];
    room.currentWord = randomWord.word;

    // LOSOWY IMPOSTOR
    const impostorIndex = Math.floor(Math.random() * room.players.length);
    room.impostorId = room.players[impostorIndex].id;

    // LOSOWA KOLEJNOŚĆ
    room.turnOrder = [...room.players]
      .sort(() => Math.random() - 0.5)
      .map(p => p.id);

    room.turnIndex = 0;

    // WYŚLIJ ROLE
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

    // INFO KTO MA TURĘ
    io.to(roomCode).emit("turn", {
      playerId: room.turnOrder[room.turnIndex]
    });

    io.to(roomCode).emit("history", room.history);
  });

  // MESSAGE (TYLKO AKTYWNY GRACZ)
  socket.on("message", ({ roomCode, name, message }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const currentPlayerId = room.turnOrder[room.turnIndex];

    // BLOKADA: tylko gracz z turą może pisać
    if (socket.id !== currentPlayerId) return;

    // WYŚLIJ WIADOMOŚĆ
    io.to(roomCode).emit("message", { name, message });

    // SPRAWDŹ CZY IMPOSTOR ZGADŁ
    if (
      socket.id === room.impostorId &&
      message.toLowerCase() === room.currentWord.toLowerCase()
    ) {
      io.to(roomCode).emit("gameEnd", {
        winner: "IMPOSTOR",
        word: room.currentWord
      });
    
      room.history.push(room.currentWord);
    
      // 🔥 WYŚLIJ HISTORIĘ
      io.to(roomCode).emit("history", room.history);
    
      // 🔁 NOWA RUNDA PO 2 SEKUNDACH
      setTimeout(() => {
        startNewRound(roomCode);
      }, 2000);
    
      return; // 🔥 ZOSTAW TO
    }

    // NASTĘPNA TURA
    room.turnIndex++;

    if (room.turnIndex >= room.turnOrder.length) {
      room.turnIndex = 0;
    }

    io.to(roomCode).emit("turn", {
      playerId: room.turnOrder[room.turnIndex]
    });
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      if (!room) continue;

      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit("updatePlayers", room.players);
      }
    }
  });
});

server.listen(3000, () => {
  console.log("Serwer działa na http://localhost:3000");
});
