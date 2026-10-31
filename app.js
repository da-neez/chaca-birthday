(() => {
  "use strict";

  const ROUND_SECONDS = 180;
  const MAX_PLAYERS = 4;
  const SIZE = 7;
  const CHEF_BADGES = ["🧑‍🍳", "👩‍🍳", "👨‍🍳", "👩🏽‍🍳"];
  const SPAWN_CELL = 24;
  const INGREDIENTS = {
    sponge: { name: "Sponge", icon: "🍞" },
    berry: { name: "Strawberries", icon: "🍓" },
    cream: { name: "Whipped cream", icon: "🍯" },
    candle: { name: "Birthday candle", icon: "🕯️" }
  };
  const TABLE_COUNT = 5;
  const RECIPES = [
    { name: "Berry birthday cake", items: ["sponge", "berry"] },
    { name: "Sweet candle cake", items: ["sponge", "candle"] },
    { name: "Strawberry cream cake", items: ["berry", "cream"] },
    { name: "Birthday party cake", items: ["cream", "candle"] },
    { name: "Chaca's special cake", items: ["sponge", "cream"] },
    { name: "Berry candle cake", items: ["berry", "candle"] }
  ];

  const $ = (id) => document.getElementById(id);
  const el = {
    hero: $("hero"),
    roomPanel: $("room-panel"),
    hostLobby: $("host-lobby"),
    joinLobby: $("join-lobby"),
    gamePanel: $("game-panel"),
    endScreen: $("end-screen"),
    playerName: $("player-name"),
    joinName: $("join-name"),
    inviteNotice: $("invite-notice"),
    toast: $("toast"),
    answerCard: $("answer-card"),
    answerOutput: $("answer-output"),
    waitingCopy: $("waiting-copy"),
    inviteField: $("invite-field"),
    inviteLink: $("invite-link"),
    gameInviteField: $("game-invite-field"),
    gameInviteLink: $("game-invite-link"),
    answerCode: $("answer-code"),
    gameAnswerCode: $("game-answer-code"),
    board: $("kitchen-board"),
    timer: $("timer"),
    timerValue: $("timer-value"),
    orderName: $("order-name"),
    orderDescription: $("order-description"),
    recipeList: $("recipe-list"),
    trayCount: $("tray-count"),
    trayList: $("tray-list"),
    orderTip: $("order-tip"),
    scoreList: $("score-list"),
    chefCount: $("chef-count"),
    roundStatus: $("round-status"),
    partyControls: $("party-controls"),
    lobbyRoster: $("lobby-roster"),
    endTitle: $("end-title"),
    endMessage: $("end-message"),
    endScore: $("end-score"),
    endPlayer: $("end-player"),
    endLeaderboard: $("end-leaderboard")
  };

  const app = {
    mode: "idle",
    role: null,
    localPlayerId: null,
    hostId: null,
    roomId: null,
    state: null,
    timer: null,
    toastTimer: null,
    pending: new Map(),
    peers: new Map(),
    guestPeer: null,
    guestChannel: null,
    invitePayload: null,
    lastOrderId: null
  };

  const newId = () => {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };
  const safeName = (value) => value.trim().slice(0, 18) || "Birthday chef";
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const randomRecipe = () => RECIPES[Math.floor(Math.random() * RECIPES.length)];
  const isHost = () => app.role === "host";
  const isGuest = () => app.role === "guest";
  const localPlayer = () => app.state?.players.find((player) => player.id === app.localPlayerId);
  const playerName = () => localPlayer()?.name || "Birthday chef";

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("show");
    window.clearTimeout(app.toastTimer);
    app.toastTimer = window.setTimeout(() => el.toast.classList.remove("show"), 2800);
  }

  function renderTimer() {
    if (!app.state) return;
    el.timerValue.textContent = `${Math.floor(app.state.timeLeft / 60)}:${String(app.state.timeLeft % 60).padStart(2, "0")}`;
    el.timer.classList.toggle("is-low", app.state.timeLeft <= 30);
  }

  function encodePayload(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodePayload(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function inviteUrl(payload) {
    const url = new URL(window.location.href);
    url.hash = `join=${encodePayload(payload)}`;
    return url.toString();
  }

  function getInviteFromHash() {
    const match = window.location.hash.match(/^#join=(.+)$/);
    if (!match) return null;
    try {
      const payload = decodePayload(match[1]);
      return payload && typeof payload.r === "string" && typeof payload.i === "string" &&
        typeof payload.s === "string" ? payload : null;
    } catch (error) {
      console.error("Could not read the party invite:", error);
      return null;
    }
  }

  function waitForIce(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pc.removeEventListener("icegatheringstatechange", check);
        reject(new Error("Connection setup took too long. Please try making a fresh invite."));
      }, 20000);
      const check = () => {
        if (pc.iceGatheringState !== "complete") return;
        window.clearTimeout(timeout);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      pc.addEventListener("icegatheringstatechange", check);
      check();
    });
  }

  function createPeerConnection() {
    return new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
  }

  function makePlayer(name, cell, id = newId()) {
    return { id, name: safeName(name), cell, score: 0 };
  }

  function shuffle(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled;
  }

  function getNeighboringCells(cell) {
    const row = Math.floor(cell / SIZE);
    const column = cell % SIZE;
    const neighbors = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if (rowOffset === 0 && columnOffset === 0) continue;
        const nextRow = row + rowOffset;
        const nextColumn = column + columnOffset;
        if (nextRow >= 0 && nextRow < SIZE && nextColumn >= 0 && nextColumn < SIZE) {
          neighbors.push(nextRow * SIZE + nextColumn);
        }
      }
    }
    return neighbors;
  }

  function generateKitchen(playerCells = []) {
    const occupied = new Set(playerCells);
    const availableCells = Array.from({ length: SIZE * SIZE }, (_, cell) => cell)
      .filter((cell) => !occupied.has(cell));
    const ingredientKeys = Object.keys(INGREDIENTS);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const shuffled = shuffle(availableCells);
      const stationCells = shuffled.slice(0, ingredientKeys.length);
      const delivery = shuffled[ingredientKeys.length];
      const tables = shuffled.slice(ingredientKeys.length + 1, ingredientKeys.length + 1 + TABLE_COUNT);
      const blocked = new Set(tables);
      const startingCells = playerCells.length ? playerCells : [SPAWN_CELL];
      const reachable = new Set(startingCells);
      const queue = [...startingCells];
      for (let index = 0; index < queue.length; index += 1) {
        for (const neighbor of getNeighboringCells(queue[index])) {
          if (!blocked.has(neighbor) && !reachable.has(neighbor)) {
            reachable.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      if (!stationCells.every((cell) => reachable.has(cell)) || !reachable.has(delivery)) continue;
      return {
        stations: Object.fromEntries(ingredientKeys.map((key, index) => [key, stationCells[index]])),
        delivery,
        tables
      };
    }

    const shuffled = shuffle(availableCells);
    const stationCells = shuffled.slice(0, ingredientKeys.length);
    return {
      stations: Object.fromEntries(ingredientKeys.map((key, index) => [key, stationCells[index]])),
      delivery: shuffled[ingredientKeys.length],
      tables: []
    };
  }

  function createGameState(player) {
    const recipe = randomRecipe();
    return {
      phase: "lobby",
      timeLeft: ROUND_SECONDS,
      players: [player],
      kitchen: generateKitchen([player.cell]),
      order: { id: newId(), recipe: recipe.name, items: recipe.items, basket: [], contributors: [], number: 1 },
      ordersDone: 0
    };
  }

  function broadcastState() {
    if (!isHost() || !app.state) return;
    for (const { channel, playerId } of app.peers.values()) {
      if (playerId && channel.readyState === "open") {
        channel.send(JSON.stringify({ type: "state", state: app.state }));
      }
    }
    render();
  }

  function broadcastTimer() {
    if (!isHost() || !app.state) return;
    const message = JSON.stringify({ type: "timer", timeLeft: app.state.timeLeft });
    for (const { channel, playerId } of app.peers.values()) {
      if (playerId && channel.readyState === "open") channel.send(message);
    }
    renderTimer();
  }

  function sendGuestHello() {
    if (isGuest() && app.guestChannel?.readyState === "open") {
      app.guestChannel.send(JSON.stringify({ type: "hello", name: safeName(el.joinName.value) }));
    }
  }

  function applyGuestState(state) {
    if (!isGuest() || !state || !Array.isArray(state.players)) return;
    app.state = state;
    if (state.phase === "running" && el.gamePanel.hidden) enterGame();
    else if (state.phase !== "lobby" && !el.gamePanel.hidden) render();
    if (state.phase === "ended") showEndScreen();
  }

  function addPlayer(player) {
    if (!app.state || app.state.players.some((known) => known.id === player.id)) return;
    if (app.state.players.length >= MAX_PLAYERS) {
      showToast("This kitchen already has four chefs!");
      return;
    }
    app.state.players.push(player);
    broadcastState();
    renderLobbyRoster();
    showToast(`${player.name} joined the kitchen!`);
  }

  async function createInvite() {
    if (!isHost()) return;
    const activeCount = app.state?.players.length || 1;
    const connectingCount = [...app.peers.values()].filter((peer) => !peer.playerId).length;
    if (activeCount + app.pending.size + connectingCount >= MAX_PLAYERS) {
      showToast("The kitchen is full — four chefs max!");
      return;
    }
    if (!window.RTCPeerConnection) {
      showToast("This browser doesn't support direct multiplayer. Try an up-to-date browser.");
      return;
    }
    const inviteId = newId();
    const pc = createPeerConnection();
    const channel = pc.createDataChannel("chaca-kitchen");
    const record = { pc, channel, playerId: null };
    app.pending.set(inviteId, record);
    channel.onmessage = (event) => handleHostMessage(inviteId, event);
    channel.onclose = () => handlePeerClose(inviteId);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        app.pending.delete(inviteId);
        app.peers.delete(inviteId);
        showToast("That connection didn't go through. Try a new invite.");
        render();
      }
    };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);
      const url = inviteUrl({ r: app.roomId, i: inviteId, s: pc.localDescription.sdp });
      if (el.gamePanel.hidden) {
        el.inviteLink.value = url;
        el.inviteField.hidden = false;
      } else {
        el.gameInviteLink.value = url;
        el.gameInviteField.hidden = false;
      }
      showToast("Your invite link is ready to copy!");
    } catch (error) {
      app.pending.delete(inviteId);
      pc.close();
      showToast(error.message || "Couldn't make an invite. Please try again.");
    }
  }

  async function applyAnswer(rawAnswer) {
    let payload;
    try {
      payload = decodePayload(rawAnswer.trim());
    } catch (error) {
      showToast("That code doesn't look right. Ask your friend to copy it again.");
      return;
    }
    if (!payload || payload.r !== app.roomId || typeof payload.i !== "string" || typeof payload.a !== "string") {
      showToast("This connection code doesn't match your party invite.");
      return;
    }
    const peer = app.pending.get(payload.i);
    if (!peer || peer.pc.signalingState !== "have-local-offer") {
      showToast("That invite has expired. Make a fresh invite link.");
      return;
    }
    const connectingCount = [...app.peers.values()].filter((item) => !item.playerId).length;
    if ((app.state?.players.length || 0) + connectingCount >= MAX_PLAYERS) {
      showToast("The kitchen is full — four chefs max!");
      return;
    }
    try {
      await peer.pc.setRemoteDescription({ type: "answer", sdp: payload.a });
      app.peers.set(payload.i, peer);
      app.pending.delete(payload.i);
      showToast("Connecting your friend to the kitchen…");
    } catch (error) {
      console.error("Could not connect party guest:", error);
      showToast("Couldn't connect with that code. Make a fresh invite and try again.");
    }
  }

  async function joinParty() {
    if (!app.invitePayload) return;
    if (!window.RTCPeerConnection) {
      showToast("This browser doesn't support direct multiplayer. Try an up-to-date browser.");
      return;
    }
    const name = safeName(el.joinName.value);
    el.joinName.value = name;
    app.role = "guest";
    app.mode = "guest-joining";
    app.roomId = app.invitePayload.r;
    app.localPlayerId = newId();
    try {
      const pc = createPeerConnection();
      app.guestPeer = pc;
      pc.ondatachannel = (event) => {
        app.guestChannel = event.channel;
        app.guestChannel.onopen = () => {
          sendGuestHello();
          el.waitingCopy.hidden = false;
        };
        app.guestChannel.onmessage = handleGuestMessage;
        app.guestChannel.onclose = () => showToast("The host left the kitchen.");
      };
      await pc.setRemoteDescription({ type: "offer", sdp: app.invitePayload.s });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIce(pc);
      el.answerOutput.value = encodePayload({
        r: app.roomId,
        i: app.invitePayload.i,
        a: pc.localDescription.sdp,
        n: name
      });
      el.answerCard.hidden = false;
      showToast("Connection code ready! Send it to your host.");
    } catch (error) {
      console.error("Could not join birthday party:", error);
      showToast(error.message || "Couldn't join this party. Ask for a fresh invite.");
    }
  }

  function handleHostMessage(inviteId, event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.warn("Ignoring an unreadable party message:", error);
      return;
    }
    const peer = app.peers.get(inviteId) || app.pending.get(inviteId);
    if (!peer) return;
    if (message.type === "hello" && typeof message.name === "string" && !peer.playerId) {
      const player = makePlayer(message.name, 24);
      peer.playerId = player.id;
      peer.channel.send(JSON.stringify({ type: "welcome", id: player.id }));
      addPlayer(player);
      return;
    }
    if (message.type === "move" && typeof message.cell === "number" && peer.playerId) {
      movePlayer(peer.playerId, message.cell);
    }
  }

  function handleGuestMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.warn("Ignoring an unreadable kitchen update:", error);
      return;
    }
    if (message.type === "state") {
      applyGuestState(message.state);
    } else if (message.type === "timer" && Number.isInteger(message.timeLeft)) {
      if (app.state) app.state.timeLeft = message.timeLeft;
      renderTimer();
    } else if (message.type === "welcome" && typeof message.id === "string") {
      app.localPlayerId = message.id;
      app.mode = "guest-connected";
      el.hero.hidden = true;
      el.roomPanel.hidden = false;
      el.joinLobby.hidden = true;
      $("guest-waiting").hidden = false;
      $("room-title").textContent = "You're on the guest list!";
    }
  }

  function handlePeerClose(inviteId) {
    const peer = app.peers.get(inviteId) || app.pending.get(inviteId);
    app.pending.delete(inviteId);
    app.peers.delete(inviteId);
    if (peer?.playerId && app.state) {
      app.state.players = app.state.players.filter((player) => player.id !== peer.playerId);
      broadcastState();
    }
    renderLobbyRoster();
  }

  function nextOrder() {
    const recipe = randomRecipe();
    app.state.kitchen = generateKitchen(app.state.players.map((player) => player.cell));
    app.state.order = {
      id: newId(),
      recipe: recipe.name,
      items: recipe.items,
      basket: [],
      contributors: [],
      number: app.state.ordersDone + 1
    };
    broadcastState();
  }

  function isAdjacentTile(from, to) {
    const rowDistance = Math.abs(Math.floor(from / SIZE) - Math.floor(to / SIZE));
    const columnDistance = Math.abs((from % SIZE) - (to % SIZE));
    return Math.max(rowDistance, columnDistance) === 1;
  }

  function movePlayer(playerId, cell) {
    if (!isHost() || !app.state || app.state.phase !== "running" ||
      !Number.isInteger(cell) || cell < 0 || cell >= SIZE * SIZE) return;
    const player = app.state.players.find((item) => item.id === playerId);
    if (!player) return;
    if (app.state.kitchen.tables.includes(cell)) {
      if (playerId === app.localPlayerId) showToast("That wooden prep table is in the way!");
      return;
    }
    if (!isAdjacentTile(player.cell, cell)) {
      if (playerId === app.localPlayerId) showToast("Move one tile at a time!");
      return;
    }
    player.cell = cell;
    const ingredient = Object.entries(app.state.kitchen.stations).find(([, stationCell]) => stationCell === cell);
    if (ingredient) {
      const [key] = ingredient;
      const station = INGREDIENTS[key];
      const order = app.state.order;
      if (!order.items.includes(key)) {
        showToast(`${station.name} isn't on this cake's recipe.`);
      } else if (order.basket.includes(key)) {
        showToast(`${station.name} is already in the cake tray.`);
      } else {
        order.basket.push(key);
        if (!order.contributors.includes(playerId)) order.contributors.push(playerId);
        player.score += 10;
        showToast(`${player.name} added ${station.name.toLowerCase()}!`);
      }
    } else if (cell === app.state.kitchen.delivery) {
      deliverCake(player);
    }
    broadcastState();
  }

  function deliverCake(player) {
    const order = app.state.order;
    if (!order.items.every((item) => order.basket.includes(item))) {
      const missing = order.items.filter((item) => !order.basket.includes(item))
        .map((item) => INGREDIENTS[item].name.toLowerCase());
      showToast(`The cake needs ${missing.join(" and ")} first!`);
      return;
    }
    player.score += 80;
    app.state.ordersDone += 1;
    order.basket = [];
    order.contributors = [];
    showToast(`Birthday cake delivered! ${player.name} gets 80 points!`);
    celebrateDelivery();
    window.setTimeout(() => {
      if (isHost() && app.state?.phase === "running") nextOrder();
    }, 1400);
  }

  function startRound() {
    if (!isHost() || !app.state || app.state.phase === "running") return;
    app.state.phase = "running";
    app.state.timeLeft = ROUND_SECONDS;
    el.partyControls.hidden = app.mode === "solo";
    broadcastState();
    enterGame();
    window.clearInterval(app.timer);
    app.timer = window.setInterval(() => {
      if (!app.state || app.state.phase !== "running") return;
      app.state.timeLeft = Math.max(0, app.state.timeLeft - 1);
      if (app.state.timeLeft === 0) {
        app.state.phase = "ended";
        window.clearInterval(app.timer);
        showEndScreen();
        broadcastState();
      } else {
        broadcastTimer();
      }
    }, 1000);
  }

  function enterGame() {
    el.hero.hidden = true;
    el.roomPanel.hidden = true;
    el.gamePanel.hidden = false;
    el.endScreen.hidden = true;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showEndScreen() {
    if (!app.state || !app.localPlayerId) return;
    el.hero.hidden = true;
    el.roomPanel.hidden = true;
    el.gamePanel.hidden = true;
    el.endScreen.hidden = false;
    const player = localPlayer();
    if (!player) return;
    el.endTitle.textContent = app.state.ordersDone > 0 ? "You made Chaca proud!" : "Thanks for cooking, chef!";
    el.endMessage.textContent = `${app.state.ordersDone} birthday ${app.state.ordersDone === 1 ? "cake" : "cakes"} delivered in this kitchen session.`;
    el.endScore.textContent = String(player.score);
    el.endPlayer.textContent = player.name;
    const scores = [...app.state.players].sort((a, b) => b.score - a.score);
    el.endLeaderboard.innerHTML = `<ol class="score-list">${scores.map((item, index) =>
      `<li class="score-row${item.id === app.localPlayerId ? " is-local" : ""}"><span class="score-name">${index + 1}. ${escapeHtml(item.name)}</span><span class="score-value">${item.score} pts</span></li>`
    ).join("")}</ol>`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderLobbyRoster() {
    if (!app.state) return;
    el.lobbyRoster.innerHTML = app.state.players.map((player) =>
      `<span class="roster-chip">${escapeHtml(player.name)}${player.id === app.localPlayerId ? " · you" : ""}</span>`
    ).join("");
    el.chefCount.textContent = `${app.state.players.length} ${app.state.players.length === 1 ? "chef" : "chefs"}`;
  }

  function renderBoard() {
    const refreshed = app.lastOrderId !== app.state.order.id;
    app.lastOrderId = app.state.order.id;
    el.board.classList.toggle("is-refreshing", refreshed);
    if (refreshed) {
      window.setTimeout(() => el.board.classList.remove("is-refreshing"), 700);
    }
    const stations = new Map(Object.entries(app.state.kitchen.stations).map(([key, cell]) =>
      [cell, { ...INGREDIENTS[key], key }]
    ));
    stations.set(app.state.kitchen.delivery, { icon: "🎂", name: "Deliver", key: "delivery" });
    const tables = new Set(app.state.kitchen.tables);
    const playersAt = new Map();
    app.state.players.forEach((player) => {
      if (!playersAt.has(player.cell)) playersAt.set(player.cell, []);
      playersAt.get(player.cell).push(player);
    });
    el.board.innerHTML = Array.from({ length: SIZE * SIZE }, (_, cell) => {
      const station = stations.get(cell);
      const players = playersAt.get(cell) || [];
      const classNames = ["tile"];
      const table = tables.has(cell);
      if (station) {
        classNames.push("station");
        if (station.key !== "delivery") classNames.push(`station-${station.key}`);
      }
      if (table) classNames.push("table-tile");
      if (station?.key === "delivery") classNames.push("delivery");
      const description = station ? station.name : table ? "wooden prep table" : `kitchen floor tile ${cell + 1}`;
      const tokens = players.map((player) => {
        const chefIndex = app.state.players.findIndex((item) => item.id === player.id);
        const badge = CHEF_BADGES[chefIndex % CHEF_BADGES.length];
        return `<span class="player-token${player.id === app.localPlayerId ? " local-token" : ""}" data-chef="${chefIndex}" title="${escapeHtml(player.name)}" aria-label="${escapeHtml(player.name)}, chef">${badge}</span>`;
      }
      ).join("");
      return `<button type="button" class="${classNames.join(" ")}" style="--tile-index:${cell}" role="gridcell" data-cell="${cell}" aria-label="${table ? "Wooden prep table, cannot walk through" : `Move to ${escapeHtml(description)}${players.length ? `; ${players.map((player) => escapeHtml(player.name)).join(", ")} here` : ""}`}" title="${table ? "Wooden prep table" : `Move to ${escapeHtml(description)}`}">
        ${tokens ? `<span class="tile-players">${tokens}</span>` : ""}
        ${table ? '<span class="tile-icon" aria-hidden="true">🪵</span><span class="tile-name">Prep table</span>' : ""}
        ${station ? `<span class="tile-icon" aria-hidden="true">${station.icon}</span><span class="tile-name">${escapeHtml(station.name)}</span>` : ""}
      </button>`;
    }).join("");
  }

  function render() {
    if (!app.state) return;
    const isRunning = app.state.phase === "running";
    const order = app.state.order;
    renderBoard();
    renderLobbyRoster();
    renderTimer();
    el.chefCount.textContent = `${app.state.players.length} ${app.state.players.length === 1 ? "chef" : "chefs"}`;
    el.roundStatus.textContent = isRunning ? "birthday rush" : app.state.phase === "lobby" ? "waiting for the host" : "party is over";
    el.orderName.textContent = order.recipe;
    el.orderDescription.textContent = `Cake order ${order.number} · collect each ingredient, then deliver at the center counter.`;
    el.recipeList.innerHTML = order.items.map((key) => {
      const item = INGREDIENTS[key];
      return `<span class="recipe-chip${order.basket.includes(key) ? " done" : ""}">${order.basket.includes(key) ? "✓ " : ""}${item.icon} ${escapeHtml(item.name)}</span>`;
    }).join("");
    el.trayCount.textContent = `${order.basket.length} / ${order.items.length}`;
    el.trayList.innerHTML = order.basket.length
      ? order.basket.map((key) => `<span class="tray-chip">${INGREDIENTS[key].icon} ${escapeHtml(INGREDIENTS[key].name)}</span>`).join("")
      : '<span class="order-description">Nothing in the tray just yet.</span>';
    el.orderTip.textContent = order.items.every((item) => order.basket.includes(item))
      ? "Your cake is ready! Tap the cake tile at the center counter to deliver."
      : "Gather the ingredients, then deliver your cake at the center counter.";
    el.scoreList.innerHTML = [...app.state.players].sort((a, b) => b.score - a.score).map((player) =>
      `<li class="score-row${player.id === app.localPlayerId ? " is-local" : ""}"><span class="score-name">${escapeHtml(player.name)}${player.id === app.localPlayerId ? " · you" : ""}</span><span class="score-value">${player.score}</span></li>`
    ).join("");
    el.board.querySelectorAll(".tile").forEach((tile) => {
      const local = localPlayer();
      const cell = Number(tile.dataset.cell);
      const isTable = app.state.kitchen.tables.includes(cell);
      tile.disabled = !isRunning ||
        (isGuest() && app.guestChannel?.readyState !== "open") ||
        !local || isTable || !isAdjacentTile(local.cell, cell);
    });
  }

  function celebrateDelivery() {
    const layer = $("celebration-layer");
    const colors = ["#cf9963", "#f3d17c", "#c4cea1", "#d9e0a3", "#e58e71", "#9d704d"];
    for (let index = 0; index < 34; index += 1) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.textContent = index % 4 === 0 ? "✦" : index % 4 === 1 ? "♡" : "";
      piece.style.setProperty("--confetti-color", colors[index % colors.length]);
      piece.style.setProperty("--confetti-left", `${Math.random() * 100}%`);
      piece.style.setProperty("--confetti-delay", `${Math.random() * 350}ms`);
      piece.style.setProperty("--confetti-drift", `${Math.round(Math.random() * 220 - 110)}px`);
      piece.addEventListener("animationend", () => piece.remove(), { once: true });
      layer.appendChild(piece);
    }
  }

  function requestMove(cell) {
    if (!Number.isInteger(cell)) return;
    if (isHost()) {
      movePlayer(app.localPlayerId, cell);
    } else if (isGuest() && app.guestChannel?.readyState === "open") {
      app.guestChannel.send(JSON.stringify({ type: "move", cell }));
    } else if (isGuest()) {
      showToast("Still connecting to the host. One little moment!");
    }
  }

  async function copyText(value, successMessage) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const helper = document.createElement("textarea");
        helper.value = value;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand("copy");
        helper.remove();
        if (!copied) throw new Error("Clipboard access was denied.");
      }
      showToast(successMessage);
    } catch (error) {
      showToast("Couldn't copy automatically. Select the text and copy it instead.");
      console.error("Clipboard copy failed:", error);
    }
  }

  function setupHost() {
    const player = makePlayer(el.playerName.value, 24);
    app.role = "host";
    app.mode = "host";
    app.roomId = newId();
    app.localPlayerId = player.id;
    app.state = createGameState(player);
    app.pending.clear();
    app.peers.clear();
    el.hero.hidden = true;
    el.roomPanel.hidden = false;
    el.hostLobby.hidden = false;
    el.joinLobby.hidden = true;
    el.gamePanel.hidden = true;
    el.endScreen.hidden = true;
    el.partyControls.hidden = true;
    $("room-title").textContent = "Your kitchen is ready!";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setupGuestLanding() {
    app.invitePayload = getInviteFromHash();
    if (!app.invitePayload) return;
    el.inviteNotice.hidden = false;
    el.roomPanel.hidden = false;
    el.hostLobby.hidden = true;
    el.joinLobby.hidden = false;
    el.hero.hidden = false;
    $("room-title").textContent = "A seat is saved for you!";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setupSolo() {
    const player = makePlayer(el.playerName.value, 24);
    app.role = "host";
    app.mode = "solo";
    app.roomId = newId();
    app.localPlayerId = player.id;
    app.state = createGameState(player);
    app.pending.clear();
    app.peers.clear();
    el.partyControls.hidden = true;
    startRound();
  }

  function resetToHome() {
    window.clearInterval(app.timer);
    for (const peer of app.peers.values()) peer.pc.close();
    for (const peer of app.pending.values()) peer.pc.close();
    app.peers.clear();
    app.pending.clear();
    app.guestPeer?.close();
    app.guestPeer = null;
    app.guestChannel = null;
    app.role = null;
    app.mode = "idle";
    app.state = null;
    app.localPlayerId = null;
    app.roomId = null;
    app.invitePayload = null;
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    el.hero.hidden = false;
    el.roomPanel.hidden = true;
    el.gamePanel.hidden = true;
    el.endScreen.hidden = true;
    el.answerCard.hidden = true;
    $("guest-waiting").hidden = true;
    el.waitingCopy.hidden = true;
    el.inviteNotice.hidden = true;
    el.playerName.value = "";
    el.joinName.value = "";
    el.answerCode.value = "";
    el.gameAnswerCode.value = "";
    el.partyControls.hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("solo-button").addEventListener("click", setupSolo);
  $("host-button").addEventListener("click", setupHost);
  $("back-button").addEventListener("click", resetToHome);
  $("start-party-button").addEventListener("click", startRound);
  $("invite-button").addEventListener("click", createInvite);
  $("game-invite-button").addEventListener("click", createInvite);
  $("connect-button").addEventListener("click", () => applyAnswer(el.answerCode.value));
  $("game-connect-button").addEventListener("click", () => applyAnswer(el.gameAnswerCode.value));
  $("join-button").addEventListener("click", joinParty);
  $("copy-invite").addEventListener("click", () => copyText(el.inviteLink.value, "Invite link copied! Send it to a friend."));
  $("game-copy-invite").addEventListener("click", () => copyText(el.gameInviteLink.value, "Invite link copied! Send it to a friend."));
  $("copy-answer").addEventListener("click", () => copyText(el.answerOutput.value, "Connection code copied! Send it to your host."));
  $("home-button").addEventListener("click", resetToHome);
  $("play-again-button").addEventListener("click", () => {
    const name = playerName();
    resetToHome();
    el.playerName.value = name;
  });
  el.board.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-cell]");
    if (tile) requestMove(Number(tile.dataset.cell));
  });

  window.addEventListener("beforeunload", () => {
    window.clearInterval(app.timer);
    for (const peer of app.peers.values()) peer.pc.close();
    for (const peer of app.pending.values()) peer.pc.close();
    app.guestPeer?.close();
  });

  if (!window.isSecureContext && window.location.protocol !== "file:") {
    console.warn("Direct browser multiplayer requires HTTPS or localhost.");
  }
  setupGuestLanding();
})();
