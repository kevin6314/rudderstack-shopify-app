import crypto from "crypto";
import getRawBody from "raw-body";
import helmet from "koa-helmet";
import Shopify, { DataType } from "@shopify/shopify-api";
import logger from "../monitoring/logger";
import { topicMapping } from "../constants/topic-mapping";
import { dbUtils } from "../dbUtils/helpers";

/**
 * Returns all the topics for subscription
 * @param {*} storeOperations
 * @returns {Array}
 */
export const getTopicList = () => {
  const resultantTopics = [];
  Object.keys(topicMapping).forEach((key) => {
    resultantTopics.push(topicMapping[key]);
  });
  return resultantTopics;
};
/**
 * Returns the topic mapping
 * @returns {Object}
 */
export const getTopicMapping = () => {
  return topicMapping;
};

/**
 * Registers webhook subscriptions to a the specified webhook url
 * @param {*} webhookUrl
 */
export const registerWebhooks = async (
  webhookUrl,
  topic,
  shop,
  accessToken
) => {
  const client = new Shopify.Clients.Rest(shop, accessToken);
  const webhookToSubscribe = {
    topic: `${topic}`,
    address: `${webhookUrl}`,
    format: "json",
  };
  logger.info(`[registerWebhooks] topic, webhookUrl ${topic} ${webhookUrl}`);
  const response = await client.post({
    path: "webhooks",
    data: {
      webhook: webhookToSubscribe,
    },
    type: DataType.JSON,
  });
  logger.info(`[registerWebhooks] topic, webhookUrl ${topic} ${webhookUrl}`);
  logger.info(`RESPONSE: ${JSON.stringify(response.body)}`);
  return response.body.webhook.id;
};

/**
 * Call to Script Tag Endpoint loads the shopify tracking code in the store pages
 * @param {*} rudderWebhookUrl
 * @param {*} shop
 */
export const registerScriptTag = async (
  accessToken,
  rudderWebhookUrl,
  shop
) => {
  logger.info("WEBHOOK URL ", rudderWebhookUrl);
  const wrappedUrl = new URL(rudderWebhookUrl);
  const writeKey = wrappedUrl.searchParams.get("writeKey");
  const dataPlane = wrappedUrl.hostname;
  logger.info("DATAPLANE URL ", dataPlane);
  const trackingServerBaseUrl =
    process.env.SHOPIFY_TRACKER_URL ||
    "shopify-tracker.dev-rudder.rudderlabs.com";
  const scriptTagUrl = `https:\/\/${trackingServerBaseUrl}\/load?writeKey=${writeKey}&dataPlaneUrl=${dataPlane}`;

  const client = new Shopify.Clients.Rest(shop, accessToken);
  const response = await client.post({
    path: "script_tags",
    data: { script_tag: { event: "onload", src: scriptTagUrl } },
    type: DataType.JSON,
  });

  return response.body;
};

/**
 * update call to script tag api endpoint
 * @param {*} accessToken
 * @param {*} rudderWebhookUrl
 * @param {*} shop
 * @param {*} scriptTagId
 * @returns
 */
export const updateScriptTag = async (
  accessToken,
  rudderWebhookUrl,
  shop,
  scriptTagId
) => {
  const wrappedUrl = new URL(rudderWebhookUrl);
  const writeKey = wrappedUrl.searchParams.get("writeKey");
  const dataPlane = wrappedUrl.hostname;
  const cdnBaseUrl =
    process.env.SHOPIFY_TRACKER_URL ||
    "shopify-tracker.dev-rudder.rudderlabs.com";
  const scriptTagUrl = `https:\/\/${cdnBaseUrl}\/load?writeKey=${writeKey}&dataPlaneUrl=${dataPlane}`;

  const client = new Shopify.Clients.Rest(shop, accessToken);
  const response = await client.put({
    path: `script_tags/${scriptTagId}`,
    data: { script_tag: { event: "onload", src: scriptTagUrl } },
    type: DataType.JSON,
  });

  return response.body;
};

/**
 * Updates webhook subscription to specified address
 * @param {*} webhookId
 * @param {*} webhookUrl
 * @param {*} shop
 */
export const updateWebhooks = async (
  webhookId,
  webhookUrl,
  shop,
  accessToken
) => {
  const client = new Shopify.Clients.Rest(shop, accessToken);

  logger.info("inside update function");
  const webhookToUpdate = {
    id: webhookId,
    address: webhookUrl,
  };
  const response = await client.put({
    path: `webhooks/${webhookId}`,
    data: {
      webhook: webhookToUpdate,
    },
    type: DataType.JSON,
  });

  logger.info(`RESPONSE: ${JSON.stringify(response)}`);
  return response.body.webhook.id;
};

/**
 * Verify uninstallation callback and then delete from DB
 * @param {*} shop
 * @returns
 */
export const verifyAndDelete = async (shop) => {
  try {
    const config = await dbUtils.getConfigByShop(shop);
    if (!config || !config.accessToken) {
      logger.info(`[verifyAndDelete] config not found for shop: ${shop}`);
      return;
    }
    const { accessToken } = config;
    let invalidated = false;

    const client = new Shopify.Clients.Rest(shop, accessToken);
    try {
      await client.get({ path: "webhooks/count" });
    } catch (err) {
      logger.error(`[verifyAndDelete] error: ${err.message}`);
      if (err.message && err.message.includes("Unauthorized")) {
        logger.info("Token is invalidated.");
        invalidated = true;
      }
    }

    // check if token is invalidated
    if (invalidated) {
      await dbUtils.deleteShopInfo(shop);
      notifyError("shop deletion alert");
    } else {
      // shopify random uninstall call. simply ignore
      logger.info("random uninstall called");
      notifyError("falsy uninstall triggered");
    }
  } catch (error) {
    logger.error(`[verifyAndDelete] error: ${error}`);
  }
};

function notifyError(message) {
  // Simple replacement for bugsnagClient.notify
  console.error(`[NOTIFY ERROR] ${message}`);
}

export const validateHmac = async (ctx) => {
  const body = await getRawBody(ctx.req);
  const generatedHmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(body)
    .digest("base64");

  const receivedHmac = ctx.header["x-shopify-hmac-sha256"];
  return { success: generatedHmac === receivedHmac, body };
};

export const setContentSecurityHeader = (ctx, next) => {
  return helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
      frameAncestors: [
        `https://${ctx.query.shop}`,
        "https://admin.shopify.com",
      ],
    },
  })(ctx, next);
};
