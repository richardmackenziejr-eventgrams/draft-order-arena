const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const store = require('./lib/store');
const leaguesRouter = require('./routes/leagues');
const gamesRouter = require('./routes/games');
const liveRooms = require('./sockets/liveRooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', leaguesRouter);
app.use('/api', gamesRouter(io));

liveRooms.setup(io);

store.initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Draft Order Arena running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
