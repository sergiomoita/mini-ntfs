import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { MiniFileSystem, VOLUME_LABEL } from '@mini-ntfs/filesystem';

import { createApiRouter, handleApiError } from './routes.js';

const host = 'localhost';
const port = 3001;
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const configuredVolumePath = process.env.MINI_NTFS_VOLUME_PATH;
const volumePath = configuredVolumePath ? resolve(repositoryRoot, configuredVolumePath) : undefined;
const filesystem = new MiniFileSystem(volumePath);

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use('/api', createApiRouter(filesystem));
app.use(handleApiError);

app.listen(port, host, (error) => {
  if (error) {
    throw error;
  }

  console.log(`API do ${VOLUME_LABEL} em http://${host}:${port}/api`);
});
