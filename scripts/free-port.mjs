// Used by start.bat: prints the first port from argv[2] (default 3000) that nothing is listening on.
import net from "node:net";

const free = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });

let port = Number(process.argv[2]) || 3000;
while (!(await free(port))) port++;
console.log(port);
