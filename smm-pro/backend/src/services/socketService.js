// socketService.js
let _io;

function initSocket(io) {
  _io = io;
  io.on('connection', (socket) => {
    console.log('[Socket] Client connected:', socket.id);
    socket.on('join', (userId) => socket.join(`user:${userId}`));
    socket.on('disconnect', () => console.log('[Socket] Client disconnected:', socket.id));
  });
}

function emitToUser(userId, event, data) {
  if (_io) _io.to(`user:${userId}`).emit(event, data);
}

function emitToAll(event, data) {
  if (_io) _io.emit(event, data);
}

module.exports = { initSocket, emitToUser, emitToAll };
