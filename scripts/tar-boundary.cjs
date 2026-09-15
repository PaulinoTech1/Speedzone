// Serialized into both tar builds by patch-tar.cjs. Keep this function self-contained.
function validateTarBoundary(entry, cwd, path) {
  const root = path.resolve(cwd);
  const sanitize = (original, allowRoot = false, base = root, reportedPath = original) => {
    let value = String(original).replaceAll('\\', '/');
    let previous;
    do {
      previous = value;
      value = value.replace(/^\/\/[?.]\//, '').replace(/^UNC\/[^/]+\/[^/]+\/?/i, '')
        .replace(/^\/\/[^/]+\/[^/]+\/?/, '').replace(/^[a-z]:/i, '').replace(/^\/+/, '');
    } while (value !== previous);
    const relative = path.relative(root, path.resolve(base, value));
    if (value.includes('\0') || value.split('/').includes('..') || path.isAbsolute(relative) ||
        relative === '..' || relative.startsWith(`..${path.sep}`) || (!relative && !allowRoot)) {
      throw Object.assign(new Error('Extraction path or link target attempts to escape target directory'), {
        code: 'ERR_TAR_PATH_TRAVERSAL', entryPath: reportedPath, targetCwd: cwd,
      });
    }
    return value;
  };
  const safePath = sanitize(entry.path, entry.type === 'Directory' || entry.type === 'GNUDumpDir', root,
    entry.extended?.path ?? entry.globalExtended?.path ?? entry.header?.path ?? entry.path);
  if (entry.type === 'Link' || entry.type === 'SymbolicLink') {
    entry.linkpath = sanitize(entry.linkpath, false,
      entry.type === 'SymbolicLink' ? path.dirname(path.resolve(root, safePath)) : root,
      entry.extended?.linkpath ?? entry.globalExtended?.linkpath ?? entry.header?.linkpath ?? entry.linkpath);
  }
  entry.path = safePath;
}

module.exports = validateTarBoundary;
