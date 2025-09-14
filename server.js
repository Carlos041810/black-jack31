const express = require("express");
const path = require("path");
const socketHandler = require("./sockets");
require("dotenv").config();
const http = require("http");
const fs = require("fs");
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

  // Función auxiliar para renderizar vistas con el header
  function renderView(res, viewPath, viewSpecificHtml = "") {
    const headerPath = path.join(__dirname, "views", "partials", "header.html");
    const fullViewPath = path.join(__dirname, viewPath);

    // Leer ambos archivos
    fs.readFile(headerPath, "utf8", (err, headerContent) => {
      if (err) {
        console.error("Error al leer el header parcial:", err);
        return res.status(500).send("Error del servidor.");
      }

      fs.readFile(fullViewPath, "utf8", (err, viewContent) => {
        if (err) {
          console.error("Error al leer la vista:", err);
          return res.status(500).send("Error del servidor.");
        }

        // Reemplazar el marcador de posición de los elementos específicos
        const processedHeader = headerContent.replace(
          "{{VIEW_SPECIFIC_DESKTOP_ELEMENTS}}",
          viewSpecificHtml
        );

        // Reemplazar el comentario del placeholder en la vista con el header procesado
        const finalHtml = viewContent.replace(
          "<!-- El header reutilizable se insertará aquí desde el servidor -->",
          processedHeader
        );

        res.send(finalHtml);
      });
    });
  }

  // Rutas HTML
  app.get("/", (_, res) =>
    res.sendFile(path.join(__dirname, "views", "index.html"))
  );

  // Ruta para la vista del Dealer
  app.get("/dealer", (req, res) => {
    // HTML específico que solo la vista del dealer tiene en el header de escritorio
    const dealerSpecificHtml = `
        <div class="invite-section">
            <span id="roomCodeText"></span>
            <button id="copyBtn">COPY</button>
        </div>
    `;
    renderView(res, "views/dealer/index.html", dealerSpecificHtml);
  });

  // Ruta para la vista del Jugador
  app.get("/player", (req, res) => {
    // La vista del jugador no tiene elementos extra en el header, así que pasamos un string vacío
    renderView(res, "views/players/index.html", "");
  });

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
