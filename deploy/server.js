import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";

const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev: false, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, "0.0.0.0", () => {
    console.log(`Matrx Deploy ready on port ${port}`);
  });
});
