let ioInstance = null;

function initSocket(io) {
  ioInstance = io;

  io.on('connection', (socket) => {
    socket.on('join:match', (matchId) => {
      if (matchId) socket.join(`match:${matchId}`);
    });

    socket.on('leave:match', (matchId) => {
      if (matchId) socket.leave(`match:${matchId}`);
    });

    socket.on('join:tournament', (tournamentId) => {
      if (tournamentId) socket.join(`tournament:${tournamentId}`);
    });

    socket.on('join:live_feed', () => {
      socket.join('live:feed');
    });
  });

  return io;
}

function emitMatchUpdate(matchId, payload) {
  if (!ioInstance || !matchId) return;
  ioInstance.to(`match:${matchId}`).emit('match:update', payload);
  ioInstance.to('live:feed').emit('live:update', payload);
}

function emitTournamentUpdate(tournamentId, payload) {
  if (!ioInstance || !tournamentId) return;
  ioInstance.to(`tournament:${tournamentId}`).emit('tournament:update', payload);
}

module.exports = {
  initSocket,
  emitMatchUpdate,
  emitTournamentUpdate
};
