const express = require("express");
const path = require("path");
const socketHandler = require("./sockets");
require("dotenv").config();
const http = require("http");
const { createClient } = require("@libsql/client");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

async function main() {
  let db;
  try {
    db = createClient({
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });

    // Probar conexión con una consulta mínima
    await db.execute("SELECT 1;");
    console.log("✅ Conectado a Turso correctamente");
  } catch (error) {
    console.error("❌ Error al conectar con la base de datos:", error);
    process.exit(1);
  }

  // Inicializar Socket.IO y pasarlo a los módulos que lo necesiten
  const io = new Server(server);

  // Middlewares básicos
  app.use(express.static("public"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Rutas HTML
  app.get("/", (_, res) =>
    res.sendFile(path.join(__dirname, "views", "index.html"))
  );
  app.get("/dealer", (_, res) =>
    res.sendFile(path.join(__dirname, "views", "dealer", "index.html"))
  );
  app.get("/player", (_, res) =>
    res.sendFile(path.join(__dirname, "views", "players", "index.html"))
  );

  // API
  const mesasRouter = require("./routes/inicio");
  app.use("/", mesasRouter(db, io)); // Pasar io a las rutas

  // Socket.IO
  socketHandler(io, db); // Pasar io y db al manejador de sockets

  // Errores
  app.use((err, req, res, next) => {
    console.error("Ha ocurrido un error no controlado:", err);
    res
      .status(500)
      .json({
        success: false,
        error: "Error interno del servidor",
        message: err.message,
      });
  });

  // Iniciar servidor
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () =>
    console.log(`🚀 Servidor en http://localhost:${PORT}`)
  );
}

main().catch(console.error);
