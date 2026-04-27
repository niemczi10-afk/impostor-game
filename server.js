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
  { word: "kawa", hint: "napój" },
  { word: "las", hint: "natura" },
];

function createRoomCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeText(text) {
  return String(text || "").trim().toLowerCase();
}

function getPlayer(room, id) {
  return room.players.find((p) => p.id === id);
}

function emitPlayers(room) {
  io.to(room.code).emit("updatePlayers", {
    players: room.players,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    turnOrder: room.turnOrder,
    currentTurnPlayerId: room.turnOrder[room.turnIndex] || null,
  });
}

function emitSystemMessage(room, text) {
  io.to(room.code).emit("message", {
    system: true,
    text,
  });
}

function emitTurn(room) {
  const currentId = room.turnOrder[room.turnIndex];

  if (!currentId) {
    startVotePhase(room);
    return;
  }

  const currentPlayer = getPlayer(room, currentId);

  io.to(room.code).emit("turnStart", {
    playerId: currentId,
    playerName: currentPlayer ? currentPlayer.name : "Gracz",
    turnNumber: room.turnIndex + 1,
    total: room.turnOrder.length,
    round: room.round,
  });

  emitPlayers(room);
}

function beginRound(room) {
  room.phase = "play";
  room.answers = {};
  room.votes = {};
  room.turnIndex = 0;

  io.to(room.code).emit("roundStart", {
    round: room.round,
  });

  emitPlayers(room);
  emitSystemMessage(room, `Runda ${room.round}`);
  emitTurn(room);
}

function startVotePhase(room) {
  room.phase = "vote";
  room.votes = {};

  io.to(room.code).emit("voteStart", {
    round: room.round,
    players: room.players,
  });

  emitPlayers(room);
  emitSystemMessage(room, "Czas na głosowanie.");
}

function endGame(room, winner) {
  room.phase = "ended";

  io.to(room.code).emit("gameEnd", {
    winner,
    word: room.word,
  });

  emitPlayers(room);
}

function startNewGame(room) {
  room.phase = "play";
  room.round = 1;
  room.answers = {};
  room.votes = {};

  const chosen = pickRandom(words);
  room.word = chosen.word;
  room.hint = chosen.hint;

  const impostor = pickRandom(room.players);
  room.impostorId = impostor.id;

  // Kolejność odpowiadania losowana tylko raz na całą grę
  room.turnOrder = shuffleArray(room.players.map((p) => p.id));
  room.turnIndex = 0;

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

  emitSystemMessage(room, "Nowa gra rozpoczęta.");
  beginRound(room);
}

function resolveVote(room) {
  const counts = {};
  const totalPlayers = room.players.length;
  const majorityThreshold = Math.floor(totalPlayers / 2) + 1;

  for (const player of room.players) {
    const votedFor = room.votes[player.id];
    if (!votedFor) continue;
    if (!room.players.some((p) => p.id === votedFor)) continue;

    counts[votedFor] = (counts[votedFor] || 0) + 1;
  }

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    emitSystemMessage(room, "Wszyscy się wstrzymali. Rozpoczyna się kolejna runda.");
    room.round += 1;
    beginRound(room);
    return;
  }

  const [topId, topVotes] = entries[0];
  const tiedAtTop = entries.filter(([, votes]) => votes === topVotes).length > 1;

  if (tiedAtTop || topVotes < majorityThreshold) {
    emitSystemMessage(room, "Brak jednoznacznego wyniku. Rozpoczyna się kolejna runda.");
    room.round += 1;
    beginRound(room);
    return;
  }

  const votedPlayer = getPlayer(room, topId);

  if (!votedPlayer) {
    emitSystemMessage(room, "Błąd głosowania. Rozpoczyna się kolejna runda.");
    room.round += 1;
    beginRound(room);
    return;
  }

  if (topId === room.impostorId) {
    emitSystemMessage(room, `${votedPlayer.name} został wybrany. Crewmates wygrywają.`);
    endGame(room, "crewmates");
    return;
  }

  emitSystemMessage(room, `${votedPlayer.name} został wyeliminowany. Impostor wygrywa.`);
  endGame(room, "impostor");
}

function removePlayerFromActiveRound(room, playerId) {
  const orderIndex = room.turnOrder.indexOf(playerId);

  if (orderIndex !== -1) {
    room.turnOrder.splice(orderIndex, 1);

    if (orderIndex < room.turnIndex) {
      room.turnIndex -= 1;
    }

    if (room.phase === "play") {
      const currentId = room.turnOrder[room.turnIndex];

      if (!currentId) {
        startVotePhase(room);
        return;
      }

      if (playerId === currentId) {
        if (room.turnIndex >= room.turnOrder.length) {
          startVotePhase(room);
        } else {
          emitTurn(room);
        }
      }
    }
  }

  if (room.phase === "vote") {
    delete room.votes[playerId];

    const allVotesIn = room.players.every((p) =>
      Object.prototype.hasOwnProperty.call(room.votes, p.id)
    );

    if (allVotesIn) {
      resolveVote(room);
    }
  }
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }) => {
    const playerName = String(name || "").trim();

    if (!playerName) {
      socket.emit("errorMessage", "Podaj swój nick.");
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
      turnOrder: [],
      turnIndex: 0,
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
      socket.emit("errorMessage", "Podaj swój nick.");
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

    if (room.phase === "play") {
      socket.emit("errorMessage", "Gra już trwa.");
      return;
    }

    if (room.players.length < 3) {
      socket.emit("errorMessage", "Do startu potrzeba minimum 3 graczy.");
      return;
    }

    startNewGame(room);
    emitPlayers(room);
  });

  socket.on("message", ({ code, text }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const room = rooms[roomCode];
    const msg = String(text || "").trim();

    if (!room || !msg) return;
    if (room.phase !== "play") return;

    const currentId = room.turnOrder[room.turnIndex];
    if (socket.id !== currentId) {
      socket.emit("errorMessage", "Nie twoja tura.");
      return;
    }

    if (room.answers[socket.id]) {
      socket.emit("errorMessage", "Już odpowiedziałeś w tej rundzie.");
      return;
    }

    const sender = getPlayer(room, socket.id);

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

    room.turnIndex += 1;

    if (room.turnIndex >= room.turnOrder.length) {
      startVotePhase(room);
      return;
    }

    emitTurn(room);
  });

  socket.on("vote", ({ code, target }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const room = rooms[roomCode];

    if (!room) return;
    if (room.phase !== "vote") return;

    const voteTarget = target === null || target === "" ? null : String(target);

    if (voteTarget === socket.id) {
      room.votes[socket.id] = null;
    } else {
      room.votes[socket.id] = voteTarget;
    }

    const allVotesIn = room.players.every((p) =>
      Object.prototype.hasOwnProperty.call(room.votes, p.id)
    );

    if (allVotesIn) {
      resolveVote(room);
    }
  });

  socket.on("disconnect", () => {
    for (const room of Object.values(rooms)) {
      const index = room.players.findIndex((p) => p.id === socket.id);
      if (index === -1) continue;

      room.players.splice(index, 1);

      if (room.hostId === socket.id) {
        room.hostId = room.players[0]?.id || null;
      }

      removePlayerFromActiveRound(room, socket.id);

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
