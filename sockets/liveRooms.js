// Live-mode gameplay over Socket.IO. Spectators/players join a room per game
// instance (`game:<id>`) so the HTTP-triggered live lottery reveal
// (routes/games.js) has somewhere to broadcast to.
function setup(io) {
  io.on('connection', (socket) => {
    socket.on('join-room', ({ gameInstanceId }) => {
      if (gameInstanceId) socket.join(`game:${gameInstanceId}`);
    });
  });
}

module.exports = { setup };
