// Sandboxed Windows can fail uv_os_get_passwd with ENOMEM. Third-party CLIs
// such as tsx call os.userInfo() during startup even though they only need a
// temporary directory. Provide a deterministic fallback in this environment.
const os = require("node:os");

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    uid: -1,
    gid: -1,
    username: process.env.USERNAME || "developer",
    homedir: process.env.USERPROFILE || process.cwd(),
    shell: null,
  });
}
