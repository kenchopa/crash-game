const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

// Initialize Express and create a server
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

// Serve the static HTML file
app.use(express.static(path.join(__dirname)));

// Game configuration variables
const baseMultiplier = 0.1;  // Base multiplier for the start of the game
let currentMultiplier = baseMultiplier;  // Start multiplier at baseMultiplier
let isGameRunning = false;
let crashPoint = 0;
let interval = null;
let players = {};  // Store player info: bets, cash-out status

// Function to generate random crash point based on baseMultiplier
const generateCrashPoint = () => {
  // Ensure crash point is generated starting from slightly above baseMultiplier
  return (Math.random() * (5 - baseMultiplier) + baseMultiplier).toFixed(2);  // Random crash between baseMultiplier and 5x
};

// Function to start the game
const startGame = () => {
  isGameRunning = true;
  currentMultiplier = baseMultiplier;  // Reset the current multiplier to baseMultiplier
  crashPoint = generateCrashPoint();
  console.log(`New Game Started! Crash point: ${crashPoint}x`);

  // Broadcast game start to all clients
  io.emit('gameStart', { crashPoint });

  // Increment multiplier every 100ms
  interval = setInterval(() => {
    currentMultiplier += 0.01;  // Increment multiplier
    io.emit('multiplierUpdate', { multiplier: currentMultiplier });

    // Check if crash point is reached
    if (currentMultiplier >= crashPoint) {
      clearInterval(interval);
      isGameRunning = false;
      io.emit('gameCrash', { crashPoint });
      console.log(`Game Crashed at ${crashPoint}x`);

      // Handle the players who didn't cash out
      Object.keys(players).forEach((playerId) => {
        if (!players[playerId].cashedOut && players[playerId].betAmount > 0) {
          io.to(playerId).emit('playerLost', { message: 'You lost your bet!' });
          players[playerId].betAmount = 0; // Reset bet
        }
      });

      // Restart game after 5 seconds
      setTimeout(startGame, 5000);
    }
  }, 100); // Increase every 100ms
};

// Handle player connections
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Initialize player data
  players[socket.id] = { betAmount: 0, cashedOut: false };

  // If the game is not running, start it
  if (!isGameRunning) {
    startGame();
  }

  // Send the current multiplier to new players
  socket.emit('multiplierUpdate', { multiplier: currentMultiplier });

  // Handle placing bets
  socket.on('placeBet', (amount) => {
    if (!isGameRunning) {
      socket.emit('betFailed', { message: 'Game not running. Wait for the next round.' });
      return;
    }
    if (players[socket.id].betAmount > 0) {
      socket.emit('betFailed', { message: 'You already placed a bet!' });
      return;
    }

    players[socket.id].betAmount = amount;
    players[socket.id].cashedOut = false;
    socket.emit('betSuccess', { amount });
    console.log(`Player ${socket.id} placed a bet of ${amount}`);
  });

  // Handle cashing out
  socket.on('cashOut', () => {
    if (players[socket.id].betAmount > 0 && !players[socket.id].cashedOut) {
      players[socket.id].cashedOut = true;
      const payout = (players[socket.id].betAmount * currentMultiplier).toFixed(2);
      socket.emit('cashOutSuccess', { payout });
      console.log(`Player ${socket.id} cashed out at ${currentMultiplier}x, payout: ${payout}`);
    } else {
      socket.emit('cashOutFailed', { message: 'Unable to cash out.' });
    }
  });

  // Handle player disconnection
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete players[socket.id];  // Remove player from list
  });
});

// Serve a simple welcome message on the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
