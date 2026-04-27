const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

// przykładowe słowa
const words = [
  { word: "pies", hint: "zwierzę" },
  { word: "samochód", hint: "transport" },
  { word: "pizza", hint: "jedzenie" },
  { word: "telefon", hint: "technologia" },
];

function createRoomCode() {
  return Math.random().toString(36).substr(2, 5);
}

io.on("connection", (socket) => {
  console.log("user connected", socket.id);

  socket.on("createRoom", (name) => {
    const code = createRoomCode();

    rooms[code] = {
      players: [],
      host: socket.id,
      started: false,
      word: null,
      hint: null,
      impostor: null,
      answers: {},
      votes: {},
    };

    rooms[code].players.push({
      id: socket.id,
      name,
    });

    socket.join(code);
    socket.emit("roomJoined", code);

    io.to(code).emit("updatePlayers", rooms[code].players);
  });

  socket.on("joinRoom", ({ code, name }) => {
    const room = rooms[code];
    if (!room) return;

    room.players.push({ id: socket.id, name });

    socket.join(code);
    socket.emit("roomJoined", code);

    io.to(code).emit("updatePlayers", room.players);
  });

  socket.on("startGame", (code) => {
    const room = rooms[code];
    if (!room) return;
    if (room.host !== socket.id) return;

    const random = words[Math.floor(Math.random() * words.length)];

    room.word = random.word;
    room.hint = random.hint;
    room.answers = {};
    room.votes = {};

    const impostor =
      room.players[Math.floor(Math.random() * room.players.length)];

    room.impostor = impostor.id;

    room.players.forEach((p) => {
      if (p.id === room.impostor) {
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

    io.to(code).emit("roundStart");
  });

  socket.on("message", ({ code, text }) => {
    const room = rooms[code];
    if (!room) return;

    room.answers[socket.id] = text;

    io.to(code).emit("message", {
      player: socket.id,
      text,
    });

    // impostor zgadł słowo
    if (socket.id === room.impostor && text === room.word) {
      io.to(code).emit("gameEnd", {
        winner: "impostor",
        word: room.word,
      });
      return;
    }

    // wszyscy odpowiedzieli
    if (Object.keys(room.answers).length === room.players.length) {
      io.to(code).emit("voteStart");
    }
  });

  socket.on("vote", ({ code, target }) => {
    const room = rooms[code];
    if (!room) return;

    room.votes[socket.id] = target;

    if (Object.keys(room.votes).length === room.players.length) {
      const counts = {};

      Object.values(room.votes).forEach((v) => {
        if (!v) return;
        counts[v] = (counts[v] || 0) + 1;
      });

      let max = 0;
      let winner = null;
      let tie = false;

      for (let k in counts) {
        if (counts[k] > max) {
          max = counts[k];
          winner = k;
          tie = false;
        } else if (counts[k] === max) {
          tie = true;
        }
      }

      if (tie || !winner) {
        io.to(code).emit("gameEnd", {
          winner: "impostor",
          word: room.word,
        });
      } else if (winner === room.impostor) {
        io.to(code).emit("gameEnd", {
          winner: "crewmates",
          word: room.word,
        });
      } else {
        io.to(code).emit("gameEnd", {
          winner: "impostor",
          word: room.word,
        });
      }
    }
  });

  socket.on("disconnect", () => {
    for (let code in rooms) {
      const room = rooms[code];
      room.players = room.players.filter((p) => p.id !== socket.id);

      io.to(code).emit("updatePlayers", room.players);
    }
  });
});

server.listen(3000, () => console.log("server running"));
