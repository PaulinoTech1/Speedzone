export function consolePath(path: string) {
  return `${process.env.NEXT_PUBLIC_SECURITY_CONSOLE_BASE_PATH || ""}${path === "/" ? "" : path}` || "/";
}
