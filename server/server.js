import "@babel/polyfill";
import dotenv from "dotenv";
import "isomorphic-fetch";
import mongoose from "mongoose";
import createShopifyAuth, { verifyRequest } from "@shopify/koa-shopify-auth";
import Shopify, { ApiVersion } from "@shopify/shopify-api";
import Koa from "koa";
import next from "next";
import Router from "koa-router";
// import bodyParser from "koa-body-parser";
import {
  fetchRudderWebhookUrl,
  registerWebhooksAndScriptTag,
  updateWebhooksAndScriptTag,
} from "./service/process";
import { DBConnector } from "./dbUtils/dbConnector";
import { dbUtils } from "./dbUtils/helpers";
import {
  verifyAndDelete,
  validateHmac,
  setContentSecurityHeader,
} from "./webhooks/helper";
import serviceOptions from "./monitoring/serviceOptions";
import logger from "./monitoring/logger";
import tracker from "../tracker/server";
import mount from "koa-mount";

dotenv.config();
const port = parseInt(process.env.PORT, 10) || 8081;
const dev = process.env.NODE_ENV !== "production";
const app = next({
  dev,
});
const handle = app.getRequestHandler();

let dbConnected = false;
DBConnector.setConfigFromEnv()
  .connect()
  .then(() => {
    dbConnected = true;
    logger.info("Connected to DB successfully");
  })
  .catch((err) => {
    logger.error(`DB connection Failed: ${err}`);
    process.exit(1);
  });

const REQUIRED_SCOPES = [
  "read_checkouts",
  "read_orders",
  "read_customers",
  "read_fulfillments",
  "write_script_tags",
];

Shopify.Context.initialize({
  API_KEY: process.env.SHOPIFY_API_KEY,
  API_SECRET_KEY: process.env.SHOPIFY_API_SECRET,
  SCOPES: REQUIRED_SCOPES,
  HOST_NAME: process.env.HOST.replace(/https:\/\/|\/$/g, ""),
  API_VERSION: ApiVersion.October21,
  IS_EMBEDDED_APP: true,
  // This should be replaced with your preferred storage strategy
  SESSION_STORAGE: new Shopify.Session.MemorySessionStorage(),
});

// Storing the currently active shops in memory will force them to re-login when your server restarts. You should
// persist this object in your app.
const ACTIVE_SHOPIFY_SHOPS = {};

Shopify.Webhooks.Registry.addHandler("APP_UNINSTALLED", {
  path: "/webhooks",
  webhookHandler: async (topic, shop, body) =>
    delete ACTIVE_SHOPIFY_SHOPS[shop],
});

app.prepare().then(async () => {
  const server = new Koa();
  const router = new Router();
  server.keys = [Shopify.Context.API_SECRET_KEY];
  // server.use(bodyParser());
  server.use(setContentSecurityHeader);
  // Mount tracker loader snippet at /load.js
  server.use(mount("/load.js", tracker.routes()));
  server.use(mount("/load.js", tracker.allowedMethods()));
  // Optionally, mount /load/health
  server.use(mount("/load/health", tracker.routes()));
  server.use(mount("/load/health", tracker.allowedMethods()));

  server.use(
    createShopifyAuth({
      accessMode: "offline",
      async afterAuth(ctx) {
        logger.info("Shopify Auth - afterAuth called");
        const { shop, accessToken, scope } = ctx.state.shopify;
        const host = ctx.query.host;
        logger.info(
          `afterAuth: shop=${shop}, accessToken=${accessToken}, scope=${scope}, host=${host}`
        );

        ACTIVE_SHOPIFY_SHOPS[shop] = scope;

        try {
          const currentShopInfo = await dbUtils.getDataByShop(shop);
          logger.info(
            `afterAuth: currentShopInfo=${JSON.stringify(currentShopInfo)}`
          );
          if (currentShopInfo) {
            currentShopInfo.config.accessToken = accessToken;
            await dbUtils.updateShopInfo(shop, currentShopInfo);
            logger.info("afterAuth: updated existing shop info");
          } else {
            const newShopInfo = {
              shopname: shop,
              config: { accessToken },
            };
            logger.info("afterAuth: inserting new shop info");
            await dbUtils.insertShopInfo(newShopInfo);
            logger.info("afterAuth: inserted new shop info");
          }
        } catch (err) {
          logger.error(`afterAuth: error while querying DB: ${err}`);
        }

        ctx.redirect(`/?shop=${shop}&host=${host}`);
      },
    })
  );

  const handleRequest = async (ctx) => {
    await handle(ctx.req, ctx.res);
    ctx.respond = false;
    ctx.res.statusCode = 200;
  };

  router.post("/webhooks", async (ctx) => {
    try {
      const { success } = await validateHmac(ctx);
      logger.info("validation stauts", success);
      if (!success) {
        ctx.body = "Unauthorized";
        ctx.status = 401;
        return ctx;
      }

      logger.info("inside /webhooks route");
      logger.info(`CTX QUERY: ${JSON.stringify(ctx.request.query)}`);
      logger.info(`CTX: ${JSON.stringify(ctx)}`);

      const { shop } = ctx.request.query;
      await verifyAndDelete(shop);
      delete ACTIVE_SHOPIFY_SHOPS[shop];
      logger.info(`Webhook processed, returned status code 200`);
      await Shopify.Webhooks.Registry.process(ctx.req, ctx.res);
      ctx.body = "OK";
      ctx.status = 200;
      return ctx;
    } catch (error) {
      logger.error(`Call to /webhooks failed: ${error}`);
      ctx.status = 500;
    }
  });

  router.post(
    "/graphql",
    verifyRequest({ returnHeader: true }),
    async (ctx, next) => {
      await Shopify.Utils.graphqlProxy(ctx.req, ctx.res);
    }
  );

  router.get(
    "/register/webhooks",
    verifyRequest({
      returnHeader: true,
      accessMode: "offline",
    }),
    async (ctx) => {
      const rudderWebhookUrl = ctx.request.query.url;
      const shop = ctx.get("shop");

      try {
        await registerWebhooksAndScriptTag(rudderWebhookUrl, shop);
        ctx.body = { success: true };
        ctx.status = 200;
      } catch (err) {
        logger.error(`error in /register/webhooks ${err}`);
        ctx.body = { success: false, error: err.message };
        ctx.status = 500;
      }
      return ctx;
    }
  );

  router.get(
    "/update/webhooks",
    verifyRequest({
      returnHeader: true,
      accessMode: "offline",
    }),
    async (ctx) => {
      // Revert to original: use the URL from the query string
      const rudderWebhookUrl = ctx.request.query.url;
      const shop = ctx.get("shop");
      try {
        await updateWebhooksAndScriptTag(rudderWebhookUrl, shop);
        ctx.body = { success: true };
        ctx.status = 200;
      } catch (err) {
        logger.error(`error in /update/webhooks ${err}`);
        ctx.body = { success: false, error: err.message };
        ctx.status = 500;
      }
      return ctx;
    }
  );

  router.get(
    "/fetch/rudder-webhook",
    verifyRequest({
      accessMode: "offline",
      returnHeader: true,
    }),
    async (ctx) => {
      try {
        logger.info("fetch/rudder-webhook ctx header", ctx.header);
        const shop = ctx.get("shop");
        const rudderWebhookUrl = await fetchRudderWebhookUrl(shop);
        logger.info(`FROM FETCH ROUTE :${rudderWebhookUrl}`);
        ctx.body = {
          rudderWebhookUrl: rudderWebhookUrl,
        };
        ctx.status = 200;
      } catch (error) {
        logger.error(`Failed to fetch dataplane: ${error}`);
        ctx.status = 500;
      }
      return ctx;
    }
  );

  // health endpoint is exposed by rudder-service
  // this route is for kubernetes readiness and liveness probes
  router.get("/ready", (ctx) => {
    let response = "Not ready";
    let status = 400;
    if (dbConnected && mongoose.connection.readyState === 1) {
      response = "OK";
      status = 200;
    }
    ctx.body = response;
    ctx.status = status;
    return ctx;
  });

  // GDPR mandatory route. Deleting shop information here
  router.post("/shop/redact", async (ctx) => {
    const { success, body } = await validateHmac(ctx);
    if (!success) {
      ctx.body = "Unauthorized";
      ctx.status = 401;
      return ctx;
    }

    logger.info("shop redact called");
    const { shop_domain } = JSON.parse(body.toString());
    await dbUtils.deleteShopInfo(shop_domain);
    ctx.body = "OK";
    ctx.status = 200;
    return ctx;
  });

  // GDPR mandatory route. RudderStack is not storing any customer releated
  // information.
  router.post("/customers/data_request", async (ctx) => {
    const { success } = await validateHmac(ctx);
    if (!success) {
      ctx.body = "Unauthorized";
      ctx.status = 401;
      return ctx;
    }
    ctx.body = "OK";
    ctx.status = 200;
    return ctx;
  });

  // GDPR mandatory route. RudderStack is not storing any customer releated
  // information.
  router.post("/customers/redact", async (ctx) => {
    const { success } = await validateHmac(ctx);
    if (!success) {
      ctx.body = "Unauthorized";
      ctx.status = 401;
      return ctx;
    }
    ctx.body = "OK";
    ctx.status = 200;
    return ctx;
  });

  router.get("(/_next/static/.*)", handleRequest); // Static content is clear
  router.get("/_next/webpack-hmr", handleRequest); // Webpack content is clear
  router.get("/", async (ctx) => {
    if (ctx.header["x-shopify-hmac-sha256"]) {
      const { success } = await validateHmac(ctx);
      if (!success) {
        ctx.body = "Unauthorized";
        ctx.status = 401;
        return ctx;
      }
    }

    const shop = ctx.query.shop;
    if (!shop) {
      ctx.body = "Shop info is required";
      ctx.status = 400;
      return ctx;
    }

    // Reinstate standard auth check: redirect to /auth if shop not active or host missing
    if (ACTIVE_SHOPIFY_SHOPS[shop] === undefined || !ctx.query.host) {
      logger.info("redirecting to auth/shop");
      ctx.redirect(`/auth?shop=${shop}`);
    } else {
      logger.info("going to handleRequest");
      await handleRequest(ctx);
    }
  });

  server.use(router.allowedMethods());
  server.use(router.routes());
  server.listen(port, "0.0.0.0", () => {
    logger.info(`> Ready on http://0.0.0.0:${port}`);
  });
});
