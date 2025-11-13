// event_server.js

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// === DB SETUP ===
const dbFile = "/var/data/candlebrain.db";

const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS email_opens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      domain TEXT,
      subject TEXT,
      ip TEXT,
      user_agent TEXT,
      timestamp TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS email_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      domain TEXT,
      subject TEXT,
      url TEXT,
      ip TEXT,
      user_agent TEXT,
      timestamp TEXT
    )
  `);
});

const app = express();

// Mailgun will send JSON (we'll set that later)
app.use(express.json());

// === WEBHOOK ENDPOINT FOR MAILGUN EVENTS ===
app.post("/mailgun/events", (req, res) => {
  const eventData = req.body["event-data"];

  if (!eventData) {
    console.log("No event-data in payload");
    return res.status(400).send("No event-data");
  }

  const eventType = eventData.event;
  const email = eventData.recipient;
  const domain = eventData.domain || null;
  const subject =
    (eventData.message &&
      eventData.message.headers &&
      eventData.message.headers.subject) ||
    null;
  const ip = eventData.ip || null;
  const userAgent =
    (eventData["client-info"] &&
      `${eventData["client-info"].client_name || ""} ${eventData["client-info"].client_type || ""} ${eventData["client-info"].user_agent || ""}`.trim()) ||
    null;
  const timestamp = new Date(eventData.timestamp * 1000).toISOString();

  if (eventType === "opened") {
    db.run(
      `
      INSERT INTO email_opens (email, domain, subject, ip, user_agent, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [email, domain, subject, ip, userAgent, timestamp],
      (err) => {
        if (err) console.error("DB error (opens):", err.message);
      }
    );
    console.log(`OPENED: ${email} (${domain})`);
  } else if (eventType === "clicked") {
    const url = eventData.url || null;

    db.run(
      `
      INSERT INTO email_clicks (email, domain, subject, url, ip, user_agent, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [email, domain, subject, url, ip, userAgent, timestamp],
      (err) => {
        if (err) console.error("DB error (clicks):", err.message);
      }
    );
    console.log(`CLICKED: ${email} -> ${eventData.url}`);
  } else {
    console.log("Unhandled event type:", eventType);
  }

  res.status(200).send("OK");
});

// === SIMPLE DASHBOARD ===
app.get("/", (req, res) => {
  db.serialize(() => {
    db.all(
      "SELECT * FROM email_opens ORDER BY datetime(timestamp) DESC LIMIT 50",
      [],
      (err, opens) => {
        if (err) {
          console.error(err);
          return res.status(500).send("DB error");
        }

        db.all(
          "SELECT * FROM email_clicks ORDER BY datetime(timestamp) DESC LIMIT 50",
          [],
          (err2, clicks) => {
            if (err2) {
              console.error(err2);
              return res.status(500).send("DB error");
            }

            const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>CandleBrain Email Analytics</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #0b1020; color: #f5f5f5; }
    h1, h2 { color: #ff4b7a; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th, td { border: 1px solid #333; padding: 6px 8px; font-size: 13px; }
    th { background: #141a33; }
    tr:nth-child(even) { background: #15182a; }
    a { color: #7dd3fc; }
  </style>
</head>
<body>
  <h1>CandleBrain Email Analytics</h1>

  <h2>Last 50 Opens</h2>
  <table>
    <tr>
      <th>Time</th>
      <th>Email</th>
      <th>Domain</th>
      <th>Subject</th>
      <th>IP</th>
      <th>User Agent</th>
    </tr>
    ${opens
      .map(
        (o) => `
      <tr>
        <td>${o.timestamp}</td>
        <td>${o.email}</td>
        <td>${o.domain || ""}</td>
        <td>${o.subject || ""}</td>
        <td>${o.ip || ""}</td>
        <td>${o.user_agent || ""}</td>
      </tr>
    `
      )
      .join("")}
  </table>

  <h2>Last 50 Clicks</h2>
  <table>
    <tr>
      <th>Time</th>
      <th>Email</th>
      <th>Domain</th>
      <th>Subject</th>
      <th>URL</th>
      <th>IP</th>
      <th>User Agent</th>
    </tr>
    ${clicks
      .map(
        (c) => `
      <tr>
        <td>${c.timestamp}</td>
        <td>${c.email}</td>
        <td>${c.domain || ""}</td>
        <td>${c.subject || ""}</td>
        <td><a href="${c.url}" target="_blank">${c.url}</a></td>
        <td>${c.ip || ""}</td>
        <td>${c.user_agent || ""}</td>
      </tr>
    `
      )
      .join("")}
  </table>
</body>
</html>
`;

            res.send(html);
          }
        );
      }
    );
  });
});

const PORT = process.env.PORT || 9000;

app.listen(PORT, () => {
  console.log(`Event server running on http://localhost:${PORT}`);
  console.log(`Expecting Mailgun webhooks at POST /mailgun/events`);
});
