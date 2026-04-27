const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

const words = [
  { word: "pies", hint: "zwierzę" },
  { word: "samochód", hint: "transport" },
  { word: "pizza", hint: "jedzenie" },
  { word: "telefon", hint: "technologia" },
  { word: "plaża", hint: "wakacje" },
  { word: "szkoła", hint: "miejsce" },
];

function createRoomCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeText(text) {
  return String(text || "")
    .trim()
    .toLowerCase();
}

function emitPlayers(room) {
  io.to(room.code).emit("updatePlayers", {
    players: room.players,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
  });
}

function emitSystemMessage(room, text) {
  io.to(room.code).emit("message", {
    system: true,
    text,
  });
}

function startNewRound(room, keepSameRoles = true) {
  room.phase = "play";
  room.answers = {};
  room.votes = {};

  if (!keepSameRoles || !room.word || !room.hint || !room.impostorId) {
    const chosen = pickRandom(words);
    room.word = chosen.word;
    room.hint = chosen.hint;

    const impostor = pickRandom(room.players);
    room.impostorId = impostor.id;

    room.players.forEach((p) => {
      if (p.id === room.impostorId) {
        io.to(p.id).emit("role", {
          role: "impostor",
          hint: room.hint,
        });
      } else {
        io.to(p.id).emit("role", {
          role: "crewmate",
          word: room.word,
        });
      }
    });
  }

  io.to(room.code).emit("roundStart", {
    round: room.round,
  });

  emitSystemMessage(room, `Runda ${room.round} — wpisz jedno słowo, odpowiedź albo skojarzenie.`);
}

function endGame(room, winner) {
  room.phase = "ended";
  io.to(room.code).emit("gameEnd", {
    winner,
    word: room.word,
  });
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }) => {
    const playerName = String(name || "").trim();
    if (!playerName) {
      socket.emit("errorMessage", "Podaj swoje imię.");
      return;
    }

    const code = createRoomCode();

    rooms[code] = {
      code,
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName }],
      phase: "lobby",
      round: 0,
      word: null,
      hint: null,
      impostorId: null,
      answers: {},
      votes: {},
    };

    socket.join(code);
    socket.emit("roomJoined", {
      code,
      hostId: socket.id,
    });

    emitPlayers(rooms[code]);
  });

  socket.on("joinRoom", ({ code, name }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const playerName = String(name || "").trim();
    const room = rooms[roomCode];

    if (!playerName) {
      socket.emit("errorMessage", "Podaj swoje imię.");
      return;
    }

    if (!room) {
      socket.emit("errorMessage", "Pokój nie istnieje.");
      return;
    }

    if (room.phase !== "lobby") {
      socket.emit("errorMessage", "Gra już trwa. Nie można dołączyć.");
      return;
    }

    if (room.players.length >= 6) {
      socket.emit("errorMessage", "Pokój jest pełny. Maksymalnie 6 graczy.");
      return;
    }

    if (room.players.some((p) => p.name.toLowerCase() === playerName.toLowerCase())) {
      socket.emit("errorMessage", "Taki nick już jest w pokoju.");
      return;
    }

    room.players.push({ id: socket.id, name: playerName });
    socket.join(roomCode);

    socket.emit("roomJoined", {
      code: roomCode,
      hostId: room.hostId,
    });

    emitPlayers(room);
  });

  socket.on("startGame", ({ code }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("errorMessage", "Pokój nie istnieje.");
      return;
    }

    if (room.hostId !== socket.id) {
      socket.emit("errorMessage", "Tylko host może uruchomić grę.");
      return;
    }

    if (room.players.length < 3) {
      socket.emit("errorMessage", "Do startu potrzeba minimum 3 graczy.");
      return;
    }

    room.phase = "play";
    room.round = 1;
    room.answers = {};
    room.votes = {};

    const chosen = pickRandom(words);
    room.word = chosen.word;
    room.hint = chosen.hint;

    const impostor = pickRandom(room.players);
    room.impostorId = impostor.id;

    io.to(room.code).emit("gameReset");

    room.players.forEach((p) => {
      if (p.id === room.impostorId) {
        io.to(p.id).emit("role", {
          role: "impostor",
          hint: room.hint,
        });
      } else {
        io.to(p.id).emit("role", {
          role: "crewmate",
          word: room.word,
        });
      }
    });

    io.to(room.code).emit("roundStart", {
      round: room.round,
    });

    emitSystemMessage(room, "Nowa gra rozpoczęta.");
    emitSystemMessage(room, "Runda 1 — wpisz jedno słowo, odpowiedź albo skojarzenie.");

    emitPlayers(room);
  });

  socket.on("message", ({ code, text }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const room = rooms[roomCode];
    const msg = String(text || "").trim();

    if (!room || !msg) return;
    if (room.phase !== "play") return;
    if (room.answers[socket.id]) return;

    const sender = room.players.find((p) => p.id === socket.id);

    room.answers[socket.id] = msg;

    io.to(room.code).emit("message", {
      system: false,
      playerId: socket.id,
      playerName: sender ? sender.name : "Gracz",
      text: msg,
    });

    if (
      socket.id === room.impostorId &&
      normalizeText(msg) === normalizeText(room.word)
    ) {
      endGame(room, "impostor");
      return;
    }

    if (Object.keys(room.answers).length === room.players.length) {
      room.phase = "vote";
      io.to(room.code).emit("voteStart", {
        round: room.round,
        players: room.players,
      });
      emitSystemMessage(room, "Czas na głosowanie.");
    }
  });

  socket.on("vote", ({ code, target }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const room = rooms[roomCode];

    if (!room) return;
    if (room.phase !== "vote") return;

    const voteTarget = target === null || target === "" ? null : String(target);

    // impostor nie może głosować na siebie
    if (voteTarget === socket.id) {
      room.votes[socket.id] = null;
    } else {
      room.votes[socket.id] = voteTarget;
    }

    if (Object.keys(room.votes).length < room.players.length) return;

    const counts = {};
    for (const votedId of Object.values(room.votes)) {
      if (!votedId) continue; // abstencja
      counts[votedId] = (counts[votedId] || 0) + 1;
    }

    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      emitSystemMessage(room, "Brak głosów. Impostor wygrywa.");
      endGame(room, "impostor");
      return;
    }

    const [topId, topVotes] = entries[0];
    const secondVotes = entries[1] ? entries[1][1] : 0;

    // eliminacja tylko przy jednoznacznym wyniku
    if (topVotes === secondVotes) {
      emitSystemMessage(room, "Brak jednoznacznego wyniku. Impostor wygrywa.");
      endGame(room, "impostor");
      return;
    }

    const votedPlayer = room.players.find((p) => p.id === topId);

    if (!votedPlayer) {
      emitSystemMessage(room, "Błąd głosowania. Impostor wygrywa.");
      endGame(room, "impostor");
      return;
    }

    if (topId === room.impostorId) {
      emitSystemMessage(room, `${votedPlayer.name} został wybrany. Crewmates wygrywają.`);
      endGame(room, "crewmates");
      return;
    }

    // zły typ wyeliminowany -> impostor wygrywa
    emitSystemMessage(room, `${votedPlayer.name} został wyeliminowany. Impostor wygrywa.`);
    endGame(room, "impostor");
  });

  socket.on("disconnect", () => {
    for (const room of Object.values(rooms)) {
      const index = room.players.findIndex((p) => p.id === socket.id);
      if (index === -1) continue;

      room.players.splice(index, 1);

      if (room.hostId === socket.id) {
        room.hostId = room.players[0]?.id || null;
      }

      if (room.players.length === 0) {
        delete rooms[room.code];
        continue;
      }

      emitPlayers(room);
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server działa.");
});
