// These are the dependencies for this file.
//
// You installed the `dotenv` and `octokit` modules earlier. The `@octokit/webhooks` is a dependency of the `octokit` module, so you don't need to install it separately. The `fs` and `http` dependencies are built-in Node.js modules.
import dotenv from "dotenv";
import { App, Octokit } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import fs from "fs";
import http from "http";
import { handlePullRequestOpened } from "./handlers/pull-requests.js";
import { handlePush } from "./handlers/pushes.js";

// This reads your `.env` file and adds the variables from that file to the `process.env` object in Node.js.
dotenv.config();

// This assigns the values of your environment variables to local variables.
const appId = process.env.APP_ID;
const webhookSecret = process.env.WEBHOOK_SECRET;
const privateKey = process.env.SYNC_PRIVATE_KEY;
const token = process.env.PERSONAL_ACCESS_TOKEN;

// This creates a new instance of the Octokit App class.
const app = new App({
  appId: appId,
  privateKey: privateKey,
  webhooks: {
    secret: webhookSecret,
  },
});

const octokit = new Octokit({ auth: token });

const { data } = await app.octokit.request('/app')

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// This sets up a webhook event listener. 

// Check if the "syncPushes" feature is enabled in the config file's settings
//When your app receives a webhook event from GitHub with a `X-GitHub-Event` header value of `push`, it calls the `handlePush` event handler that is defined in /handlers/pushes.js.
if (config.settings && config.settings.features.syncPushes) {
  app.webhooks.on("push", (webhook) => handlePush(webhook, config, token));
}

// Check if the "syncPullRequests" feature is enabled in the config file's settings
//When your app receives a webhook event from GitHub with a `X-GitHub-Event` header value of `pull_request` and an `action` payload value of `opened`, it calls the `handlePullRequestOpened` event handler that is defined in /handlers/pull-requests.js.
if (config.settings && config.settings.features.syncPullRequests) {
  app.webhooks.on("pull_request.opened", (webhook) => handlePullRequestOpened(webhook, config, octokit));
//  app.webhooks.on("pull_request.synchronize", (webhook) => handlePullRequestOpened(webhook, config, octokit));
  app.webhooks.on("pull_request.closed", (webhook) => handlePullRequestClosed(webhook, config, octokit));
};

// This logs any errors that occur.
app.webhooks.onError((error) => {
  if (error.name === "AggregateError") {
    console.error(`Error processing request: ${error.event}`);
  } else {
    console.error(error);
  }
});

// This determines where your server will listen.
//
// For local development, your server will listen to port 3000 on `localhost`. When you deploy your app, you will change these values. For more information, see "[Deploy your app](#deploy-your-app)."
const port = 3000;
const host = 'localhost';
const path = "/api/webhook";
const localWebhookUrl = `http://${host}:${port}${path}`;

// This sets up a middleware function to handle incoming webhook events.
//
// Octokit's `createNodeMiddleware` function takes care of generating this middleware function for you. The resulting middleware function will:
//
//    - Check the signature of the incoming webhook event to make sure that it matches your webhook secret. This verifies that the incoming webhook event is a valid GitHub event.
//    - Parse the webhook event payload and identify the type of event.
//    - Trigger the corresponding webhook event handler.
const middleware = createNodeMiddleware(app.webhooks, { path });

// This creates a Node.js server that listens for incoming HTTP requests (including webhook payloads from GitHub) on the specified port. When the server receives a request, it executes the `middleware` function that you defined earlier. Once the server is running, it logs messages to the console to indicate that it is listening.
http.createServer(middleware).listen(port, () => {
  console.log(`Authenticated as '${data.name}'`);
  console.log(`Server is listening for events at: ${localWebhookUrl}`);
  console.log('Press Ctrl + C to quit.');
});
