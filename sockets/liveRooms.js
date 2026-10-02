// Live-mode gameplay over Socket.IO. Spectators/players join a room per game
// instance (`game:<id>`). Nothing broadcasts to these rooms right now -- the only
// live-mode game (the old 40 Yard Dash lottery reveal) has been removed and every
// remaining game is async -- but the room plumbing is kept for any future live game.
function setup(io) {
  io.on('connection', (socket) => {
    socket.on('join-room', ({ gameInstanceId }) => {
      if (gameInstanceId) socket.join(`game:${gameInstanceId}`);
    });
  });
}

module.exports = { setup };
