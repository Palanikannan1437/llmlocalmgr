import { downloadFromHub } from './controllers/downloadFiles.mjs';
import { buildDataStructure } from './utils/hgDataStructure.mjs';
import { fetchPageAndExtractURLs } from './utils/extractUrlsFromPage.mjs';
import { log } from './utils/logger.mjs';
import promiseLimitter from "./utils/concurrency-limit/promise-limitter.mjs"
import { buildMLCLocalConfig } from './controllers/buildMLCLocalConfig.mjs';

const downloadConcurrency = parseInt(process.env.MODEL_DOWNLOAD_CONCURRENCY) || 4;
const limit = promiseLimitter(downloadConcurrency);

const server = Bun.serve({
  port: process.env.HOST_PORT || 8000,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return handleRootRequest();
    }
    if (url.pathname === "/model-config") {
      return handleModelConfigRequest();
    }
    return new Response('Not found', { status: 404 });
  },
});

console.log(`Server listening on localhost:${server.port}`);

async function handleRootRequest() {
  try {
    const huggingFaceURLs = await fetchPageAndExtractURLs();
    const dataStructure = buildDataStructure(huggingFaceURLs);
    log('info', 'Starting model downloads');

    const downloadPromises = dataStructure.models.map(model => {
      return limit(() => {
        log('info', `Started downloading files of ${model.url}`);
        return downloadFromHub(`./weights/${model.name}`, model.modelRepoOrPath)
          .then(() => {
            log('success', `Finished downloading files of ${model.url}`);
          })
          .catch((e) => {
            log('error', e,`Error downloading files of ${model.url}`);
          });
      });
    });

    const results = await Promise.allSettled(downloadPromises);
    const failedDownloads = results.filter(result => result.status === 'rejected');

    if (failedDownloads.length > 0) {
      log('error', `${failedDownloads.length} model(s) failed to download.`);
      return new Response(`${failedDownloads.length} model(s) failed to download.`);
    } else {
      log('success', 'Weights downloaded successfully');
      return new Response('Weights downloaded successfully');
    }
  } catch (error) {
    log('error', 'An error occurred');
    return new Response('An error occurred');
  }
}

async function handleModelConfigRequest() {
  const huggingFaceURLs = await fetchPageAndExtractURLs();
  const config = buildMLCLocalConfig(huggingFaceURLs);
  return new Response(JSON.stringify(config));
}