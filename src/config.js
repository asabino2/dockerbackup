const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');

module.exports = {
  port: Number(process.env.PORT || 3000),
  dataDir,
  storePath: path.join(dataDir, 'store.json'),
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  helperImage: process.env.HELPER_IMAGE || 'node:20-bookworm-slim',
};