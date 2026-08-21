export async function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8").replace(/[\r\n]+$/, "");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolvePromise, reject) => {
    let value = "";
    let settled = false;
    const close = () => {
      if (settled) return false;
      settled = true;
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      return true;
    };
    const finish = () => {
      if (close()) resolvePromise(value);
    };
    function onData(chunk) {
      for (const character of chunk) {
        if (character === "\u0003") {
          if (close()) reject(new Error("Cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          const codePoints = [...value];
          codePoints.pop();
          value = codePoints.join("");
        } else if ((character.codePointAt(0) ?? 0) >= 0x20) {
          value += character;
        }
      }
    }
    process.stdin.on("data", onData);
  });
}
